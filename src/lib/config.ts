import { homedir } from "os";
import { join } from "path";
import { mkdir } from "fs/promises";

export interface ConnectionConfig {
  url: string;
  name?: string;
  isDefault?: boolean;
}

export interface SillonConfig {
  defaultConnection?: string; // raw URL default
  defaultConnectionName?: string; // named connection default (takes precedence)
  currentDb?: string; // last-used database (sillon db use <name>)
  connections: Record<string, string>;
  editor?: string;
  output?: "auto" | "json" | "table";
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private config: SillonConfig | null = null;

  constructor(configDir?: string) {
    this.configDir = configDir ?? join(homedir(), ".config", "sillon");
    this.configPath = join(this.configDir, "config.json");
  }

  getConfigPath(): string {
    return this.configPath;
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

  async removeConnection(name: string): Promise<void> {
    const config = await this.load();

    if (!config.connections[name]) {
      throw new Error(`No connection named "${name}"`);
    }

    delete config.connections[name];

    // Clear default if it was pointing at this name
    if (config.defaultConnectionName === name) {
      delete config.defaultConnectionName;
      delete config.defaultConnection;
    }

    await this.save(config);
  }

  /** Set default by named connection (stored connection must exist). */
  async setDefaultByName(name: string): Promise<void> {
    const config = await this.load();

    if (!config.connections[name]) {
      throw new Error(`No connection named "${name}"`);
    }

    config.defaultConnectionName = name;
    config.defaultConnection = config.connections[name];
    await this.save(config);
  }

  /** Set default by raw URL (no name required). */
  async setDefaultConnection(url: string): Promise<void> {
    const config = await this.load();
    config.defaultConnection = url;
    delete config.defaultConnectionName; // raw URL takes over, clear named default
    await this.save(config);
  }

  async getActiveConnection(): Promise<ConnectionConfig> {
    const config = await this.load();

    // Named default takes precedence
    if (config.defaultConnectionName) {
      const url = config.connections[config.defaultConnectionName];
      if (url) {
        return { url, name: config.defaultConnectionName, isDefault: true };
      }
      // Named connection was deleted — fall through
    }

    // Raw URL default
    if (config.defaultConnection) {
      return { url: config.defaultConnection, isDefault: true };
    }

    // COUCHDB_URL env var
    if (process.env.COUCHDB_URL) {
      return { url: process.env.COUCHDB_URL };
    }

    // Auto-detect local CouchDB
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
        "Run: sillon connect <url>  or set COUCHDB_URL env var",
    );
  }

  async getConnection(name: string): Promise<ConnectionConfig | null> {
    const config = await this.load();
    const url = config.connections[name];
    if (!url) return null;
    const isDefault = config.defaultConnectionName === name;
    return { url, name, isDefault };
  }

  async listConnections(): Promise<ConnectionConfig[]> {
    const config = await this.load();
    return Object.entries(config.connections).map(([name, url]) => ({
      name,
      url,
      isDefault: config.defaultConnectionName === name,
    }));
  }

  /** Get the last-used database (set via `sillon db use <name>`). */
  async getCurrentDb(): Promise<string | undefined> {
    const config = await this.load();
    return config.currentDb;
  }

  /** Persist the current working database. */
  async setCurrentDb(db: string): Promise<void> {
    const config = await this.load();
    config.currentDb = db;
    await this.save(config);
  }
}
