import { spawn, $ } from "bun";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

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
}

export class LocalRuntime {
  private version: string;
  private port: number;
  private adminUser: string;
  private adminPass: string;
  private dataDir: string;
  private pidFile: string;

  constructor(options: LocalRuntimeOptions = {}) {
    this.version = options.version ?? "3.3.3";
    this.port = options.port ?? 5984;
    this.adminUser = options.adminUser ?? "admin";
    this.adminPass = options.adminPass ?? "password";
    this.dataDir = join(homedir(), ".local", "share", "sillon", "couchdb", this.version);
    this.pidFile = join(homedir(), ".local", "share", "sillon", "couchdb.pid");
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
      "  Mise:   https://mise.jdx.dev/getting-started.html"
    );
  }

  async stop(): Promise<void> {
    if (!existsSync(this.pidFile)) {
      throw new Error("CouchDB is not running (no PID file found)");
    }

    const pid = parseInt(await Bun.file(this.pidFile).text());

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

      await Bun.file(this.pidFile).delete();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to stop CouchDB: ${msg}`);
    }
  }

  async status(): Promise<LocalStatus> {
    if (!existsSync(this.pidFile)) {
      return { running: false };
    }

    try {
      const pid = parseInt(await Bun.file(this.pidFile).text());
      process.kill(pid, 0); // Throws if process doesn't exist

      return {
        running: true,
        url: `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`,
        pid,
        version: this.version,
      };
    } catch {
      // Stale PID file — clean it up
      try { await Bun.file(this.pidFile).delete(); } catch { /* ignore */ }
      return { running: false };
    }
  }

  private async detectRuntime(): Promise<"podman" | "mise" | "binary"> {
    // Prefer podman — no extra toolchain needed
    try {
      const proc = Bun.spawn(["which", "podman"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode === 0) return "podman";
    } catch { /* not available */ }

    // Fall back to mise
    try {
      const proc = Bun.spawn(["which", "mise"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode === 0) return "mise";
    } catch { /* not available */ }

    return "binary";
  }

  private async startPodman(): Promise<string> {
    const containerName = "sillon-couchdb";

    // Remove any existing container with the same name
    try { await $`podman rm -f ${containerName}`.quiet(); } catch { /* ignore */ }

    const proc = spawn([
      "podman", "run", "-d",
      "--name", containerName,
      "-p", `${this.port}:5984`,
      "-e", `COUCHDB_USER=${this.adminUser}`,
      "-e", `COUCHDB_PASSWORD=${this.adminPass}`,
      "-v", `${this.dataDir}:/opt/couchdb/data`,
      `docker.io/apache/couchdb:${this.version}`,
    ], { stdout: "pipe", stderr: "pipe" });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`podman failed: ${stderr.trim()}`);
    }

    // Record the container's host PID for status/stop tracking
    const pidText = await $`podman inspect -f '{{.State.Pid}}' ${containerName}`.text();
    const pid = parseInt(pidText.trim());
    await Bun.write(this.pidFile, pid.toString());

    await this.waitForReady();

    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async startMise(): Promise<string> {
    // Install the requested version if not already present
    await $`mise install couchdb@${this.version}`.quiet();

    // Resolve the binary path for this exact version
    const binPath = (await $`mise which --version ${this.version} couchdb`.text()).trim();

    // Build a minimal ini config so couchdb uses our port and admin
    const localIni = join(this.dataDir, "local.ini");
    await Bun.write(localIni, `[httpd]
port = ${this.port}
bind_address = 127.0.0.1

[admins]
${this.adminUser} = ${this.adminPass}
`);

    const proc = spawn([binPath, "-a", localIni], {
      cwd: this.dataDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Detach so the parent process doesn't wait on CouchDB
    proc.unref();

    await Bun.write(this.pidFile, proc.pid.toString());
    await this.waitForReady();

    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async waitForReady(): Promise<void> {
    const url = `http://localhost:${this.port}/_up`;
    const maxAttempts = 30;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(url);
        if (resp.status === 200) return;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(`Timeout: CouchDB did not become ready after ${maxAttempts}s`);
  }
}
