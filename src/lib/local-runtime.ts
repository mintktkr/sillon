import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { $, spawn } from "bun";
import { mkdir } from "fs/promises";

export interface LocalRuntimeOptions {
  version?: string;
  port?: number;
  adminUser?: string;
  adminPass?: string;
}

export interface LocalStatus {
  running: boolean;
  url?: string;
  pid?: number;
  version?: string;
  runtime?: "podman" | "mise";
}

// Persisted state written alongside the pidFile
interface RuntimeState {
  runtime: "podman" | "mise";
  pid: number;
  containerName?: string; // only for podman
  version: string;
  port: number;
  adminUser: string;
}

export class LocalRuntime {
  private version: string;
  private port: number;
  private adminUser: string;
  private adminPass: string;
  private dataDir: string;
  private stateFile: string;

  constructor(options: LocalRuntimeOptions = {}) {
    this.version = options.version ?? "3.3.3";
    this.port = options.port ?? 5984;
    this.adminUser = options.adminUser ?? "admin";
    this.adminPass = options.adminPass ?? "password";
    this.dataDir = join(
      homedir(),
      ".local",
      "share",
      "sillon",
      "couchdb",
      this.version,
    );
    this.stateFile = join(
      homedir(),
      ".local",
      "share",
      "sillon",
      "couchdb.state.json",
    );
  }

  async start(): Promise<string> {
    const current = await this.status();
    if (current.running) {
      throw new Error(`CouchDB already running at ${current.url}`);
    }

    await mkdir(this.dataDir, { recursive: true });

    const method = await this.detectRuntime();

    if (method === "podman") return this.startPodman();
    if (method === "mise") return this.startMise();

    throw new Error(
      "No supported runtime found. Please install Podman or Mise:\n" +
        "  Podman: https://podman.io/getting-started/installation\n" +
        "  Mise:   https://mise.jdx.dev/getting-started.html",
    );
  }

  async stop(): Promise<void> {
    const stateText = await this.readState();
    if (!stateText) {
      throw new Error("CouchDB is not running (no state file found)");
    }

    if (stateText.runtime === "podman" && stateText.containerName) {
      await this.stopPodman(stateText.containerName);
    } else {
      await this.stopProcess(stateText.pid);
    }

    await this.clearState();
  }

  async status(): Promise<LocalStatus> {
    const state = await this.readState();
    if (!state) return { running: false };

    // Verify the process/container is still alive
    const alive =
      state.runtime === "podman" && state.containerName
        ? await this.isPodmanRunning(state.containerName)
        : this.isProcessAlive(state.pid);

    if (!alive) {
      await this.clearState();
      return { running: false };
    }

    return {
      running: true,
      url: `http://${state.adminUser}:${this.adminPass}@localhost:${state.port}`,
      pid: state.pid,
      version: state.version,
      runtime: state.runtime,
    };
  }

  private async detectRuntime(): Promise<"podman" | "mise" | "binary"> {
    // Prefer podman — no extra toolchain needed
    try {
      const proc = Bun.spawn(["which", "podman"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (proc.exitCode === 0) return "podman";
    } catch {
      /* not available */
    }

    // Fall back to mise
    try {
      const proc = Bun.spawn(["which", "mise"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (proc.exitCode === 0) return "mise";
    } catch {
      /* not available */
    }

    return "binary";
  }

  private async startPodman(): Promise<string> {
    const containerName = "sillon-couchdb";

    // Remove any existing container with the same name
    try {
      await $`podman rm -f ${containerName}`.quiet();
    } catch {
      /* ignore */
    }

    const proc = spawn(
      [
        "podman",
        "run",
        "-d",
        "--name",
        containerName,
        "-p",
        `${this.port}:5984`,
        "-e",
        `COUCHDB_USER=${this.adminUser}`,
        "-e",
        `COUCHDB_PASSWORD=${this.adminPass}`,
        "-v",
        `${this.dataDir}:/opt/couchdb/data`,
        `docker.io/apache/couchdb:${this.version}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`podman failed: ${stderr.trim()}`);
    }

    // Record the container's host PID for status tracking (informational only)
    const pidText =
      await $`podman inspect -f '{{.State.Pid}}' ${containerName}`.text();
    const pid = Number.parseInt(pidText.trim());

    await this.writeState({
      runtime: "podman",
      pid,
      containerName,
      version: this.version,
      port: this.port,
      adminUser: this.adminUser,
    });

    await this.waitForReady();

    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async startMise(): Promise<string> {
    // Install the requested version if not already present
    await $`mise install couchdb@${this.version}`.quiet();

    // Resolve the binary path for this exact version
    const binPath = (
      await $`mise which --version ${this.version} couchdb`.text()
    ).trim();

    // Build a minimal ini config so couchdb uses our port and admin
    const localIni = join(this.dataDir, "local.ini");
    await Bun.write(
      localIni,
      `[httpd]
port = ${this.port}
bind_address = 127.0.0.1

[admins]
${this.adminUser} = ${this.adminPass}
`,
    );

    const proc = spawn([binPath, "-a", localIni], {
      cwd: this.dataDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Detach so the parent process doesn't wait on CouchDB
    proc.unref();

    await this.writeState({
      runtime: "mise",
      pid: proc.pid,
      version: this.version,
      port: this.port,
      adminUser: this.adminUser,
    });

    await this.waitForReady();

    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async stopPodman(containerName: string): Promise<void> {
    try {
      await $`podman stop ${containerName}`.quiet();
      await $`podman rm ${containerName}`.quiet();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to stop podman container: ${msg}`);
    }
  }

  private async stopProcess(pid: number): Promise<void> {
    try {
      process.kill(pid, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Force kill if still alive
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to stop CouchDB process: ${msg}`);
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async isPodmanRunning(containerName: string): Promise<boolean> {
    try {
      const proc = Bun.spawn(
        ["podman", "inspect", "-f", "{{.State.Running}}", containerName],
        { stdout: "pipe", stderr: "pipe" },
      );
      await proc.exited;
      if (proc.exitCode !== 0) return false;
      const out = await new Response(proc.stdout).text();
      return out.trim() === "true";
    } catch {
      return false;
    }
  }

  private async readState(): Promise<RuntimeState | null> {
    try {
      const file = Bun.file(this.stateFile);
      if (!(await file.exists())) return null;
      return (await file.json()) as RuntimeState;
    } catch {
      return null;
    }
  }

  private async writeState(state: RuntimeState): Promise<void> {
    await mkdir(join(homedir(), ".local", "share", "sillon"), {
      recursive: true,
    });
    await Bun.write(this.stateFile, JSON.stringify(state, null, 2));
  }

  private async clearState(): Promise<void> {
    try {
      await Bun.file(this.stateFile).delete();
    } catch {
      /* ignore */
    }
  }

  private async waitForReady(): Promise<void> {
    const url = `http://localhost:${this.port}/_up`;
    const maxAttempts = 30;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(url);
        if (resp.status === 200) return;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(
      `Timeout: CouchDB did not become ready after ${maxAttempts}s`,
    );
  }
}
