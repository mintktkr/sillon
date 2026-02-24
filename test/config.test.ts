import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ConfigManager } from "../src/lib/config";
import { mkdir, rm } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

describe("ConfigManager", () => {
  const testDir = join(homedir(), ".config", "sillon-test");
  let config: ConfigManager;

  beforeEach(async () => {
    // Create isolated test config dir
    await mkdir(testDir, { recursive: true });
    config = new ConfigManager(testDir);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await rm(testDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it("should load default config", async () => {
    const cfg = await config.load();
    expect(cfg.connections).toEqual({});
    expect(cfg.output).toBe("auto");
  });

  it("should save and retrieve connections", async () => {
    await config.saveConnection("test", "http://localhost:5984");
    const cfg = await config.load();
    expect(cfg.connections["test"]).toBe("http://localhost:5984");
  });

  it("should set default connection", async () => {
    await config.setDefaultConnection("http://admin:pass@localhost:5984");
    const active = await config.getActiveConnection();
    expect(active.url).toBe("http://admin:pass@localhost:5984");
  });
});
