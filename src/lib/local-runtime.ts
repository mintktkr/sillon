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
    this.version = options.version || "3.3.3";
    this.port = options.port || 5984;
    this.adminUser = options.adminUser || "admin";
    this.adminPass = options.adminPass || "password";
    this.dataDir = join(homedir(), ".local", "share", "sillon", "couchdb", this.version);
    this.pidFile = join(homedir(), ".local", "share", "sillon", "couchdb.pid");
  }

  async start(): Promise<string> {
    // Check if already running
    const current = await this.status();
    if (current.running) {
      throw new Error(`CouchDB already running at ${current.url}`);
    }

    // Ensure data directory exists
    await mkdir(this.dataDir, { recursive: true });

    // Detect best runtime method
    const method = await this.detectRuntime();
    
    switch (method) {
      case "podman":
        return this.startPodman();
      case "mise":
        return this.startMise();
      default:
        return this.startBinary();
    }
  }

  async stop(): Promise<void> {
    if (!existsSync(this.pidFile)) {
      throw new Error("CouchDB is not running (no PID file found)");
    }

    const pid = parseInt(await Bun.file(this.pidFile).text());
    
    try {
      process.kill(pid, "SIGTERM");
      // Wait for shutdown
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      // Force kill if still running
      try {
        process.kill(pid, 0); // Check if still exists
        process.kill(pid, "SIGKILL");
      } catch {
        // Already stopped
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
      process.kill(pid, 0); // Check if process exists
      
      return {
        running: true,
        url: `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`,
        pid,
        version: this.version,
      };
    } catch {
      // PID file exists but process is dead
      try {
        await Bun.file(this.pidFile).delete();
      } catch {}
      return { running: false };
    }
  }

  private async detectRuntime(): Promise<"podman" | "mise" | "binary"> {
    // Check for podman
    try {
      const proc = Bun.spawn(["which", "podman"]);
      await proc.exited;
      if (proc.exitCode === 0) return "podman";
    } catch {}

    // Check for mise
    try {
      const proc = Bun.spawn(["which", "mise"]);
      await proc.exited;
      if (proc.exitCode === 0) {
        // Check if mise has couchdb
        const list = Bun.spawn(["mise", "list", "couchdb"]);
        await list.exited;
        if (list.exitCode === 0) return "mise";
      }
    } catch {}

    return "binary";
  }

  private async startPodman(): Promise<string> {
    const containerName = "sillon-couchdb";
    
    // Check if container exists and remove it
    try {
      await $`podman rm -f ${containerName}`.quiet();
    } catch {}

    const proc = spawn([
      "podman", "run", "-d",
      "--name", containerName,
      "-p", `${this.port}:5984`,
      "-e", `COUCHDB_USER=${this.adminUser}`,
      "-e", `COUCHDB_PASSWORD=${this.adminPass}`,
      "-v", `${this.dataDir}:/opt/couchdb/data`,
      `docker.io/apache/couchdb:${this.version}`,
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Podman failed: ${stderr}`);
    }

    // Get container PID
    const pidProc = await $`podman inspect -f '{{.State.Pid}}' ${containerName}`.text();
    const pid = parseInt(pidProc.trim());
    
    await Bun.write(this.pidFile, pid.toString());
    
    // Wait for CouchDB to be ready
    await this.waitForReady();
    
    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async startMise(): Promise<string> {
    // Install couchdb if not present
    await $`mise install couchdb@${this.version}`.quiet();
    
    // Get couchdb binary path
    const binPath = await $`mise which couchdb`.text();
    
    const proc = spawn([binPath.trim()], {
      env: {
        ...process.env,
        COUCHDB_HTTPD_PORT: this.port.toString(),
        COUCHDB_ADMINS: `${this.adminUser}=${this.adminPass}`,
      },
      cwd: this.dataDir,
    });

    // Write PID file
    await Bun.write(this.pidFile, proc.pid.toString());
    
    // Wait for ready
    await this.waitForReady();
    
    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async startBinary(): Promise<string> {
    const binaryDir = join(this.dataDir, "apache-couchdb");
    const binPath = join(binaryDir, "bin", "couchdb");

    // Download if not exists
    if (!existsSync(binPath)) {
      await this.downloadCouchDB(binaryDir);
    }

    // Create local config
    const localIni = join(this.dataDir, "local.ini");
    await Bun.write(localIni, `[httpd]
port = ${this.port}
bind_address = 0.0.0.0

[admins]
${this.adminUser} = ${this.adminPass}
`);

    const proc = spawn([binPath, "-a", localIni], {
      cwd: this.dataDir,
    });

    await Bun.write(this.pidFile, proc.pid.toString());
    await this.waitForReady();
    
    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async downloadCouchDB(targetDir: string): Promise<void> {
    console.log(`Downloading CouchDB ${this.version}...`);
    
    const platform = process.platform === "darwin" ? "macos" : "unix";
    const url = `https://dlcdn.apache.org/couchdb/source/${this.version}/apache-couchdb-${this.version}.tar.gz`;
    
    // For now, throw with instructions - downloading and building from source
    // is complex. Better to use podman or mise.
    throw new Error(
      `Binary not available. Please install Podman or Mise:\n` +
      `  Podman: https://podman.io/getting-started/installation\n` +
      `  Mise:   https://mise.jdx.dev/getting-started.html`
    );
  }

  private async waitForReady(): Promise<void> {
    const url = `http://localhost:${this.port}/_up`;
    const maxAttempts = 30;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(url);
        if (resp.status === 200) {
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    
    throw new Error("Timeout waiting for CouchDB to start");
  }
}