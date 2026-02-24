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
  runtime?: "podman" | "docker" | "nix" | "binary";
}

// Persisted state written alongside the pidFile
interface RuntimeState {
  runtime: "podman" | "docker" | "nix" | "binary";
  pid: number;
  containerName?: string; // for podman/docker
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
  private installDir: string;

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
    this.installDir = join(
      homedir(),
      ".local",
      "share",
      "sillon",
      "couchdb",
      this.version,
      "install",
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

    if (method === "nix") return this.startNix();
    if (method === "podman") return this.startPodman();
    if (method === "docker") return this.startDocker();
    return this.startBinary();
  }

  async stop(): Promise<void> {
    const stateText = await this.readState();
    if (!stateText) {
      throw new Error("CouchDB is not running (no state file found)");
    }

    if ((stateText.runtime === "podman" || stateText.runtime === "docker") && stateText.containerName) {
      await this.stopContainer(stateText.containerName, stateText.runtime);
    } else if (stateText.runtime === "nix" || stateText.runtime === "binary") {
      await this.stopProcess(stateText.pid);
    } else {
      await this.stopProcess(stateText.pid);
    }

    await this.clearState();
  }

  async status(): Promise<LocalStatus> {
    const state = await this.readState();
    if (!state) return { running: false };

    // Verify the process/container is still alive
    let alive = false;
    if ((state.runtime === "podman" || state.runtime === "docker") && state.containerName) {
      alive = await this.isContainerRunning(state.containerName, state.runtime);
    } else if (state.runtime === "nix" || state.runtime === "binary") {
      alive = this.isProcessAlive(state.pid);
    } else {
      alive = this.isProcessAlive(state.pid);
    }

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

  private async detectRuntime(): Promise<"podman" | "docker" | "nix" | "binary"> {
    // Prefer podman — daemonless containers
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

    // Fall back to docker
    try {
      const proc = Bun.spawn(["which", "docker"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (proc.exitCode === 0) return "docker";
    } catch {
      /* not available */
    }

    // Try nix (experimental - may have config issues)
    try {
      const proc = Bun.spawn(["which", "nix-shell"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (proc.exitCode === 0) return "nix";
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

  private async startDocker(): Promise<string> {
    const containerName = "sillon-couchdb";

    // Remove any existing container with the same name
    try {
      await $`docker rm -f ${containerName}`.quiet();
    } catch {
      /* ignore */
    }

    console.log(`📦 Starting CouchDB ${this.version} in Docker...`);
    console.log("  (Data will not be persisted between restarts)");

    const proc = spawn(
      [
        "docker",
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
        // Note: No volume mount for simplicity. Data is lost on container removal.
        // For persistent data, use the podman or nix runtimes.
        `apache/couchdb:${this.version}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`docker failed: ${stderr.trim()}`);
    }

    // Get container ID as PID substitute
    const cidText = await new Response(proc.stdout).text();
    const cid = cidText.trim();

    await this.writeState({
      runtime: "docker",
      pid: 0, // docker doesn't give us a host PID easily
      containerName,
      version: this.version,
      port: this.port,
      adminUser: this.adminUser,
    });

    await this.waitForReady();

    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  /**
   * Hash a plaintext password using PBKDF2-SHA1 in the format CouchDB expects:
   *   -pbkdf2-<hex(derivedKey)>,<hex(salt)>,10
   *
   * CouchDB requires PBKDF2-SHA1 with 10 iterations and a 16-byte salt.
   * Writing a pre-hashed value prevents CouchDB from double-hashing the password.
   */
  private async hashPasswordPBKDF2(password: string): Promise<string> {
    // Note: CouchDB 3.x uses PBKDF2-SHA256 by default (not SHA-1)
    // This generates a hash that should be compatible with couchdb 3.x
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );

    // CouchDB 3.x default: SHA-256, 10 iterations, 32-byte derived key
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations: 10,
      },
      keyMaterial,
      256,
    );

    const toHex = (buf: ArrayBuffer | Uint8Array) =>
      Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    return `-pbkdf2-${toHex(derivedBits)},${toHex(salt)},10`;
  }

  private async startNix(): Promise<string> {
    console.log(`📦 Starting CouchDB ${this.version} via Nix...`);
    console.log("  ⚠️  Nix runtime is experimental - auth may require manual setup");

    // Ensure data directory exists
    await mkdir(this.dataDir, { recursive: true });

    // Hash the password for CouchDB
    // Note: This is experimental - PBKDF2 hash format may differ from CouchDB's expectations
    const hashedPass = await this.hashPasswordPBKDF2(this.adminPass);

    // Write local.ini config with [chttpd] for CouchDB 3.x compatibility
    const localIni = join(this.dataDir, "local.ini");
    await Bun.write(
      localIni,
      `[couchdb]
database_dir = ${this.dataDir}
uri_file = ${join(this.dataDir, "couch.uri")}
view_index_dir = ${this.dataDir}

[chttpd]
port = ${this.port}
bind_address = 127.0.0.1

[admins]
${this.adminUser} = ${hashedPass}
`,
    );

    // Run couchdb via nix-shell
    console.log("  Starting with nix-shell...");
    const proc = spawn(
      [
        "nix-shell",
        "-p",
        "couchdb3",
        "--run",
        `couchdb -a "${localIni}"`,
      ],
      {
        cwd: this.dataDir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    proc.unref();

    await this.writeState({
      runtime: "nix",
      pid: proc.pid,
      version: this.version,
      port: this.port,
      adminUser: this.adminUser,
    });

    await this.waitForReady();

    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async startBinary(): Promise<string> {
    // Check if this is a system-installed couchdb (via pacman/apt)
    const systemBin = await this.findCouchDBBinary();

    if (systemBin && systemBin.startsWith("/usr/")) {
      // This is a system package, use systemd
      return this.startSystemCouchDB();
    }

    // Check if couchdb is already installed in our install dir
    let couchdbBin = join(this.installDir, "bin", "couchdb");

    if (!existsSync(couchdbBin)) {
      if (systemBin) {
        couchdbBin = systemBin;
      } else {
        // Download and install
        await this.downloadCouchDB();
        // Re-check after install
        if (!existsSync(couchdbBin)) {
          const newSystemBin = await this.findCouchDBBinary();
          if (newSystemBin) {
            couchdbBin = newSystemBin;
          } else {
            throw new Error("CouchDB installation failed - binary not found");
          }
        }
      }
    }

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

    console.log(`🚀 Starting CouchDB ${this.version}...`);

    const proc = spawn([couchdbBin, "-a", localIni], {
      cwd: this.dataDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Detach so the parent process doesn't wait on CouchDB
    proc.unref();

    await this.writeState({
      runtime: "binary",
      pid: proc.pid,
      version: this.version,
      port: this.port,
      adminUser: this.adminUser,
    });

    await this.waitForReady();

    return `http://${this.adminUser}:${this.adminPass}@localhost:${this.port}`;
  }

  private async startSystemCouchDB(): Promise<string> {
    console.log("🚀 Starting system CouchDB via systemd...");

    // Start the service
    try {
      await $`sudo systemctl start couchdb`;
    } catch (error) {
      throw new Error(`Failed to start couchdb service: ${error}`);
    }

    // Get the PID
    const pidText = await $`systemctl show --property=MainPID --value couchdb`.text();
    const pid = parseInt(pidText.trim());

    if (!pid || pid === 0) {
      throw new Error("Failed to get CouchDB PID from systemd");
    }

    await this.writeState({
      runtime: "binary",
      pid,
      version: this.version,
      port: 5984, // system couchdb uses default port
      adminUser: "admin", // system couchdb default
    });

    await this.waitForReady();

    return `http://admin@localhost:5984`;
  }

  private async downloadCouchDB(): Promise<void> {
    console.log(`📦 Installing CouchDB ${this.version}...`);

    // Check which package manager is available
    const hasApt = await this.commandExists("apt-get");
    const hasPacman = await this.commandExists("pacman");
    const hasBrew = await this.commandExists("brew");
    const hasSnap = await this.commandExists("snap");

    if (hasPacman) {
      // Arch Linux
      console.log("  Using pacman (Arch Linux)...");
      try {
        await $`sudo pacman -S --noconfirm couchdb`;
      } catch {
        // Might already be installed
      }
      // Find the actual couchdb binary
      const couchPath = await this.findCouchDBBinary();
      if (!couchPath) {
        throw new Error("CouchDB was not installed. Please install it manually: sudo pacman -S couchdb");
      }
      // Create symlink in our install dir
      await mkdir(join(this.installDir, "bin"), { recursive: true });
      try {
        await $`ln -sf ${couchPath} ${join(this.installDir, "bin", "couchdb")}`;
      } catch {
        // Already exists or failed, ignore
      }
    } else if (hasApt) {
      // Debian/Ubuntu
      console.log("  Using apt (Debian/Ubuntu)...");
      await $`sudo apt-get update`.quiet();
      await $`sudo apt-get install -y couchdb`.quiet();
      await mkdir(join(this.installDir, "bin"), { recursive: true });
      try {
        await $`ln -sf /usr/bin/couchdb ${join(this.installDir, "bin", "couchdb")}`;
      } catch {}
    } else if (hasBrew) {
      // macOS
      console.log("  Using brew (macOS)...");
      await $`brew install couchdb`.quiet();
      await mkdir(join(this.installDir, "bin"), { recursive: true });
      try {
        await $`ln -sf $(brew --prefix couchdb)/bin/couchdb ${join(this.installDir, "bin", "couchdb")}`;
      } catch {}
    } else if (hasSnap) {
      // Snap (Ubuntu and others)
      console.log("  Using snap...");
      await $`sudo snap install couchdb`.quiet();
      await mkdir(join(this.installDir, "bin"), { recursive: true });
      try {
        await $`ln -sf /snap/bin/couchdb ${join(this.installDir, "bin", "couchdb")}`;
      } catch {}
    } else {
      throw new Error(
        `No supported package manager found (tried: pacman, apt, brew, snap).\n` +
        `Please install CouchDB manually from https://couchdb.apache.org/\n` +
        `Or use Podman: sillon local up (requires podman)`
      );
    }

    console.log(`✅ CouchDB installed`);
  }

  private async commandExists(cmd: string): Promise<boolean> {
    try {
      const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  private async findCouchDBBinary(): Promise<string | null> {
    // Common paths where couchdb might be installed
    const paths = [
      "/usr/bin/couchdb",
      "/usr/local/bin/couchdb",
      "/opt/couchdb/bin/couchdb",
      "/usr/lib/couchdb/bin/couchdb",
    ];

    for (const path of paths) {
      if (existsSync(path)) return path;
    }

    // Try to find with which
    try {
      const proc = Bun.spawn(["which", "couchdb"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode === 0) {
        const path = (await new Response(proc.stdout).text()).trim();
        if (path) return path;
      }
    } catch {}

    return null;
  }

  private async stopContainer(containerName: string, runtime: "podman" | "docker"): Promise<void> {
    try {
      await $`${runtime} stop ${containerName}`.quiet();
      await $`${runtime} rm ${containerName}`.quiet();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to stop ${runtime} container: ${msg}`);
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

  private async isContainerRunning(containerName: string, runtime: "podman" | "docker"): Promise<boolean> {
    try {
      const proc = Bun.spawn(
        [runtime, "inspect", "-f", "{{.State.Running}}", containerName],
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
    const maxAttempts = 60; // 60 seconds timeout

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (resp.status === 200) {
          console.log("✅ CouchDB is ready!");
          return;
        }
      } catch {
        /* not ready yet */
      }
      // Show progress every 10 seconds
      if (i > 0 && i % 10 === 0) {
        console.log(`⏳ Waiting for CouchDB... (${i}s)`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(
      `Timeout: CouchDB did not become ready after ${maxAttempts}s`,
    );
  }
}
