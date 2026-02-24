import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ConfigManager } from "../src/lib/config";
import { mkdir, rm } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

describe("ConfigManager", () => {
  const testDir = join(homedir(), ".config", "sillon-test");
  let config: ConfigManager;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    config = new ConfigManager(testDir);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  // ── Load & defaults ──────────────────────────────────────────────────────

  it("should load default config when no file exists", async () => {
    const cfg = await config.load();
    expect(cfg.connections).toEqual({});
    expect(cfg.output).toBe("auto");
  });

  it("should return the same object on repeated loads (cache)", async () => {
    const first = await config.load();
    const second = await config.load();
    expect(first).toBe(second);
  });

  // ── Save & read connections ──────────────────────────────────────────────

  it("should save and retrieve a connection", async () => {
    await config.saveConnection("prod", "http://localhost:5984");
    const cfg = await config.load();
    expect(cfg.connections["prod"]).toBe("http://localhost:5984");
  });

  it("should save multiple connections", async () => {
    await config.saveConnection("prod", "http://prod.example.com:5984");
    await config.saveConnection("dev", "http://localhost:5984");
    const list = await config.listConnections();
    expect(list).toHaveLength(2);
    const names = list.map((c) => c.name);
    expect(names).toContain("prod");
    expect(names).toContain("dev");
  });

  it("should overwrite an existing connection with the same name", async () => {
    await config.saveConnection("local", "http://localhost:5984");
    await config.saveConnection("local", "http://localhost:5985");
    const conn = await config.getConnection("local");
    expect(conn?.url).toBe("http://localhost:5985");
  });

  // ── getConnection ────────────────────────────────────────────────────────

  it("should return null for unknown connection name", async () => {
    const conn = await config.getConnection("nonexistent");
    expect(conn).toBeNull();
  });

  it("should return connection info with isDefault flag", async () => {
    await config.saveConnection("staging", "http://staging:5984");
    await config.setDefaultByName("staging");
    const conn = await config.getConnection("staging");
    expect(conn?.isDefault).toBe(true);
  });

  // ── listConnections ──────────────────────────────────────────────────────

  it("should return empty list when no connections saved", async () => {
    const list = await config.listConnections();
    expect(list).toEqual([]);
  });

  it("should mark only the default connection with isDefault=true", async () => {
    await config.saveConnection("a", "http://a:5984");
    await config.saveConnection("b", "http://b:5984");
    await config.setDefaultByName("a");
    const list = await config.listConnections();
    const a = list.find((c) => c.name === "a");
    const b = list.find((c) => c.name === "b");
    expect(a?.isDefault).toBe(true);
    expect(b?.isDefault).toBeFalsy();
  });

  // ── removeConnection ─────────────────────────────────────────────────────

  it("should remove a connection", async () => {
    await config.saveConnection("temp", "http://localhost:5984");
    await config.removeConnection("temp");
    const conn = await config.getConnection("temp");
    expect(conn).toBeNull();
  });

  it("should throw when removing a non-existent connection", async () => {
    await expect(config.removeConnection("ghost")).rejects.toThrow();
  });

  it("should clear default when removing the default connection", async () => {
    await config.saveConnection("main", "http://localhost:5984");
    await config.setDefaultByName("main");
    await config.removeConnection("main");

    const cfg = await config.load();
    expect(cfg.defaultConnectionName).toBeUndefined();
    expect(cfg.defaultConnection).toBeUndefined();
  });

  // ── setDefaultByName ─────────────────────────────────────────────────────

  it("should set default by name and make getActiveConnection return it", async () => {
    await config.saveConnection("named", "http://named.example.com:5984");
    await config.setDefaultByName("named");
    const active = await config.getActiveConnection();
    expect(active.url).toBe("http://named.example.com:5984");
    expect(active.name).toBe("named");
    expect(active.isDefault).toBe(true);
  });

  it("should throw when setting default to unknown name", async () => {
    await expect(config.setDefaultByName("ghost")).rejects.toThrow();
  });

  // ── setDefaultConnection (raw URL) ───────────────────────────────────────

  it("should set default by raw URL", async () => {
    await config.setDefaultConnection("http://admin:pass@localhost:5984");
    const active = await config.getActiveConnection();
    expect(active.url).toBe("http://admin:pass@localhost:5984");
  });

  it("should clear named default when raw URL is set", async () => {
    await config.saveConnection("old", "http://old:5984");
    await config.setDefaultByName("old");
    await config.setDefaultConnection("http://new:5984");
    const cfg = await config.load();
    expect(cfg.defaultConnectionName).toBeUndefined();
    expect(cfg.defaultConnection).toBe("http://new:5984");
  });

  it("raw URL default overrides named default resolution", async () => {
    // Set raw URL as default — named default is cleared
    await config.setDefaultConnection("http://raw:5984");
    const active = await config.getActiveConnection();
    expect(active.url).toBe("http://raw:5984");
  });

  // ── currentDb ────────────────────────────────────────────────────────────

  it("should return undefined when no currentDb set", async () => {
    expect(await config.getCurrentDb()).toBeUndefined();
  });

  it("should persist currentDb across instances", async () => {
    await config.setCurrentDb("mydb");

    // New instance pointing at same dir
    const config2 = new ConfigManager(testDir);
    expect(await config2.getCurrentDb()).toBe("mydb");
  });

  it("should overwrite currentDb", async () => {
    await config.setCurrentDb("first");
    await config.setCurrentDb("second");
    expect(await config.getCurrentDb()).toBe("second");
  });

  // ── COUCHDB_URL env fallback ─────────────────────────────────────────────

  it("should fall back to COUCHDB_URL env var when no default is set", async () => {
    const original = process.env.COUCHDB_URL;
    try {
      process.env.COUCHDB_URL = "http://env-couch:5984";
      const active = await config.getActiveConnection();
      expect(active.url).toBe("http://env-couch:5984");
    } finally {
      if (original === undefined) delete process.env.COUCHDB_URL;
      else process.env.COUCHDB_URL = original;
    }
  });

  // ── getConfigPath ────────────────────────────────────────────────────────

  it("should return the correct config file path", () => {
    const path = config.getConfigPath();
    expect(path).toContain("sillon-test");
    expect(path).toEndWith("config.json");
  });
});
