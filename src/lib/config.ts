import { homedir } from "os";
import { join } from "path";
import { mkdir } from "fs/promises";

export interface ConnectionConfig {
  url: string;
  name?: string;
}

export interface SillonConfig {
  defaultConnection?: string;
  connections: Record<string, string>;
  editor?: string;
  output?: "auto" | "json" | "table";
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private config: SillonConfig | null = null;

  constructor() {
    this.configDir = join(homedir(), ".config", "sillon");
    this.configPath = join(this.configDir, "config.json");
  }

  async load(): Promise<SillonConfig> {
    if (this.config) return this.config;

    try {
      const file = Bun.file(this.configPath);
      if (await file.exists()) {
        this.config = await file.json();
        return this.config!;
      }
    } catch {
      // File doesn't exist or is invalid
    }

    // Default config
    this.config = {
      connections: {},
      editor: process.env.EDITOR || "nano",
      output: "auto",
    };
    
    return this.config;
  }

  async save(config: SillonConfig): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await Bun.write(this.configPath, JSON.stringify(config, null, 2));
    this.config = config;
  }

  async saveConnection(name: string, url: string): Promise<void> {
    const config = await this.load();
    config.connections[name] = url;
    await this.save(config);
  }

  async setDefaultConnection(url: string): Promise<void> {
    const config = await this.load();
    config.defaultConnection = url;
    await this.save(config);
  }

  async getActiveConnection(): Promise<ConnectionConfig> {
    const config = await this.load();
    
    if (config.defaultConnection) {
      return { url: config.defaultConnection };
    }
    
    // Check for COUCHDB_URL env var
    if (process.env.COUCHDB_URL) {
      return { url: process.env.COUCHDB_URL };
    }
    
    // Check for default local
    try {
      const response = await fetch("http://localhost:5984/");
      if (response.ok) {
        return { url: "http://localhost:5984" };
      }
    } catch {
      // Not running locally
    }
    
    throw new Error(
      "No CouchDB connection configured.\n" +
      "Run: sillon connect <url> or set COUCHDB_URL env var"
    );
  }

  async getConnection(name: string): Promise<ConnectionConfig | null> {
    const config = await this.load();
    const url = config.connections[name];
    return url ? { url, name } : null;
  }

  async listConnections(): Promise<ConnectionConfig[]> {
    const config = await this.load();
    return Object.entries(config.connections).map(([name, url]) => ({ name, url }));
  }
}