import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { CouchClient } from "../src/lib/couch-client";

const COUCH_URL = process.env.COUCHDB_URL ?? "http://admin:password@localhost:5984";
const TEST_DB = "sillon-test-db";

// Check if CouchDB is available before running integration tests
async function isCouchAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${COUCH_URL}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const couchAvailable = await isCouchAvailable();
const itSkip = couchAvailable ? it : it.skip;

describe("CouchClient (integration)", () => {
  let client: CouchClient;

  beforeAll(async () => {
    if (!couchAvailable) return;
    client = new CouchClient(COUCH_URL);

    // Clean up any leftover test DB
    try {
      await client.deleteDatabase(TEST_DB);
    } catch {
      // ignore
    }

    // Create fresh test DB
    await client.createDatabase(TEST_DB);
  });

  afterAll(async () => {
    if (!couchAvailable) return;
    try {
      await client.deleteDatabase(TEST_DB);
    } catch {
      // ignore
    }
  });

  // ── Server ───────────────────────────────────────────────────────────────

  itSkip("getServerInfo returns couchdb welcome", async () => {
    const info = await client.getServerInfo();
    expect(info.couchdb).toBe("Welcome");
    expect(info.version).toBeTruthy();
  });

  itSkip("listDatabases returns an array", async () => {
    const dbs = await client.listDatabases();
    expect(Array.isArray(dbs)).toBe(true);
    expect(dbs).toContain("_users");
  });

  // ── Database operations ──────────────────────────────────────────────────

  itSkip("getDatabaseInfo returns correct db_name", async () => {
    const info = await client.getDatabaseInfo(TEST_DB);
    expect(info.db_name).toBe(TEST_DB);
    expect(info.doc_count).toBe(0);
  });

  itSkip("createDatabase / deleteDatabase roundtrip", async () => {
    const tmp = `${TEST_DB}-tmp`;
    const created = await client.createDatabase(tmp);
    expect(created.ok).toBe(true);

    const dbs = await client.listDatabases();
    expect(dbs).toContain(tmp);

    const deleted = await client.deleteDatabase(tmp);
    expect(deleted.ok).toBe(true);

    const dbsAfter = await client.listDatabases();
    expect(dbsAfter).not.toContain(tmp);
  });

  itSkip("createDatabase throws on duplicate", async () => {
    await expect(client.createDatabase(TEST_DB)).rejects.toThrow();
  });

  // ── Document CRUD ────────────────────────────────────────────────────────

  itSkip("putDocument then getDocument round-trips data", async () => {
    const doc = { _id: "roundtrip-1", name: "Alice", score: 99 };
    const put = await client.putDocument(TEST_DB, doc);
    expect(put.ok).toBe(true);
    expect(put.id).toBe("roundtrip-1");
    expect(put.rev).toMatch(/^1-/);

    const got = await client.getDocument(TEST_DB, "roundtrip-1");
    expect(got._id).toBe("roundtrip-1");
    expect(got.name).toBe("Alice");
    expect(got.score).toBe(99);
  });

  itSkip("createDocument generates an id", async () => {
    const result = await client.createDocument(TEST_DB, { type: "auto-id" });
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    expect(result.rev).toMatch(/^1-/);
  });

  itSkip("putDocument update increments rev", async () => {
    const doc = { _id: "update-me", value: 1 };
    const v1 = await client.putDocument(TEST_DB, doc);

    const updated = await client.putDocument(TEST_DB, {
      _id: "update-me",
      _rev: v1.rev,
      value: 2,
    });
    expect(updated.rev).toMatch(/^2-/);

    const got = await client.getDocument(TEST_DB, "update-me");
    expect(got.value).toBe(2);
  });

  itSkip("deleteDocument removes the document", async () => {
    const put = await client.putDocument(TEST_DB, { _id: "delete-me", x: 1 });
    await client.deleteDocument(TEST_DB, "delete-me", put.rev!);
    await expect(client.getDocument(TEST_DB, "delete-me")).rejects.toThrow();
  });

  itSkip("getDocument throws for missing doc", async () => {
    await expect(client.getDocument(TEST_DB, "definitely-not-there")).rejects.toThrow();
  });

  // ── Bulk operations ──────────────────────────────────────────────────────

  itSkip("bulkDocs creates multiple documents", async () => {
    const docs = [
      { _id: "bulk-1", tag: "bulk" },
      { _id: "bulk-2", tag: "bulk" },
      { _id: "bulk-3", tag: "bulk" },
    ];
    const results = await client.bulkDocs(TEST_DB, docs);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(r.rev).toMatch(/^1-/);
    }
  });

  itSkip("bulkDocs deletes multiple documents", async () => {
    // First create
    const docsToCreate = [
      { _id: "bulk-del-1", x: 1 },
      { _id: "bulk-del-2", x: 2 },
    ];
    const created = await client.bulkDocs(TEST_DB, docsToCreate);

    // Then delete
    const toDelete = created.map((r) => ({
      _id: r.id,
      _rev: r.rev!,
      _deleted: true as const,
    }));
    const deleted = await client.bulkDocs(TEST_DB, toDelete);
    expect(deleted).toHaveLength(2);
    for (const r of deleted) {
      expect(r.ok).toBe(true);
    }
  });

  // ── getAllDocs ────────────────────────────────────────────────────────────

  itSkip("getAllDocs returns rows with id and key", async () => {
    const result = await client.getAllDocs(TEST_DB);
    expect(typeof result.total_rows).toBe("number");
    expect(Array.isArray(result.rows)).toBe(true);
  });

  itSkip("getAllDocs include_docs returns full documents", async () => {
    await client.putDocument(TEST_DB, { _id: "alldocs-test", val: 42 });
    const result = await client.getAllDocs(TEST_DB, {
      include_docs: true,
      startkey: "alldocs-test",
      endkey: "alldocs-test\uffff",
    });
    const row = result.rows.find((r) => r.id === "alldocs-test");
    expect(row?.doc?.val).toBe(42);
  });

  itSkip("getAllDocs limit restricts result count", async () => {
    const result = await client.getAllDocs(TEST_DB, { limit: 2 });
    expect(result.rows.length).toBeLessThanOrEqual(2);
  });

  itSkip("getAllDocs with keys fetches specific docs", async () => {
    await client.putDocument(TEST_DB, { _id: "keys-a", label: "a" });
    await client.putDocument(TEST_DB, { _id: "keys-b", label: "b" });

    const result = await client.getAllDocs(TEST_DB, {
      keys: ["keys-a", "keys-b"],
      include_docs: true,
    });
    expect(result.rows).toHaveLength(2);
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain("keys-a");
    expect(ids).toContain("keys-b");
  });

  // ── getDesignDocs ────────────────────────────────────────────────────────

  itSkip("getDesignDocs returns only design documents", async () => {
    // Create a design doc
    await client.putDocument(TEST_DB, {
      _id: "_design/test-ddoc",
      views: {
        all: {
          map: "function(doc) { emit(doc._id, null); }",
        },
      },
    });

    const result = await client.getDesignDocs(TEST_DB);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.id).toMatch(/^_design\//);
    }
  });

  // ── View querying ────────────────────────────────────────────────────────

  itSkip("queryView returns rows from a map view", async () => {
    // Ensure design doc exists
    try {
      await client.putDocument(TEST_DB, {
        _id: "_design/test-ddoc",
        views: {
          all: { map: "function(doc) { if(!doc._id.startsWith('_')) emit(doc._id, null); }" },
        },
      });
    } catch {
      // Already exists from design doc test — fetch rev and update
      const existing = await client.getDocument(TEST_DB, "_design/test-ddoc");
      await client.putDocument(TEST_DB, {
        ...existing,
        views: {
          all: { map: "function(doc) { if(!doc._id.startsWith('_')) emit(doc._id, null); }" },
        },
      });
    }

    const result = await client.queryView(TEST_DB, "test-ddoc", "all");
    expect(Array.isArray(result.rows)).toBe(true);
  });

  itSkip("queryView respects limit option", async () => {
    const result = await client.queryView(TEST_DB, "test-ddoc", "all", { limit: 1 });
    expect(result.rows.length).toBeLessThanOrEqual(1);
  });

  // ── Mango / _find ────────────────────────────────────────────────────────

  itSkip("mangoQuery returns matching documents", async () => {
    await client.putDocument(TEST_DB, { _id: "mango-1", type: "fruit", color: "red" });
    await client.putDocument(TEST_DB, { _id: "mango-2", type: "fruit", color: "green" });
    await client.putDocument(TEST_DB, { _id: "mango-3", type: "veggie", color: "green" });

    const result = await client.mangoQuery(TEST_DB, {
      selector: { type: "fruit" },
    });
    expect(Array.isArray(result.docs)).toBe(true);
    for (const doc of result.docs) {
      expect(doc.type).toBe("fruit");
    }
  });

  itSkip("createIndex and listIndexes roundtrip", async () => {
    const created = await client.createIndex(TEST_DB, {
      index: { fields: ["color"] },
      name: "color-index",
    });
    expect(["created", "exists"]).toContain(created.result);

    const { indexes } = await client.listIndexes(TEST_DB);
    const names = indexes.map((i) => i.name);
    expect(names).toContain("color-index");
  });

  itSkip("deleteIndex removes the index", async () => {
    // Ensure index exists
    const created = await client.createIndex(TEST_DB, {
      index: { fields: ["color"] },
      name: "color-index",
      ddoc: "color-index-ddoc",
    });

    await client.deleteIndex(TEST_DB, "color-index-ddoc", "color-index");
    const { indexes } = await client.listIndexes(TEST_DB);
    const names = indexes.map((i) => i.name);
    expect(names).not.toContain("color-index");
  });

  // ── Compact / cleanup ────────────────────────────────────────────────────

  itSkip("compact triggers without error", async () => {
    const result = await client.compact(TEST_DB);
    expect(result.ok).toBe(true);
  });

  itSkip("viewCleanup triggers without error", async () => {
    const result = await client.viewCleanup(TEST_DB);
    expect(result.ok).toBe(true);
  });

  // ── getActiveTasks ───────────────────────────────────────────────────────

  itSkip("getActiveTasks returns an array", async () => {
    const tasks = await client.getActiveTasks();
    expect(Array.isArray(tasks)).toBe(true);
  });

  // ── _replicator ──────────────────────────────────────────────────────────

  itSkip("listReplicationJobs returns AllDocsResult", async () => {
    const result = await client.listReplicationJobs();
    expect(typeof result.total_rows).toBe("number");
    expect(Array.isArray(result.rows)).toBe(true);
  });

  // ── purge ────────────────────────────────────────────────────────────────

  itSkip("purge removes specific revisions", async () => {
    const put = await client.putDocument(TEST_DB, { _id: "purge-me", v: 1 });
    // Delete the doc first so we can purge it
    await client.deleteDocument(TEST_DB, "purge-me", put.rev!);

    const deleted = await client.getDocument(TEST_DB, "purge-me").catch(() => null);
    // Find the deleted rev
    const allDocs = await client.getAllDocs(TEST_DB, {
      keys: ["purge-me"],
    });
    const row = allDocs.rows.find((r) => r.id === "purge-me");
    if (!row) return; // already gone

    const result = await client.purge(TEST_DB, { "purge-me": [row.value.rev] });
    expect(typeof result.purge_seq).toBe("string");
  });

  // ── getDbsInfo ───────────────────────────────────────────────────────────

  itSkip("getDbsInfo returns info for known databases", async () => {
    const result = await client.getDbsInfo([TEST_DB, "_users"]);
    expect(result).toHaveLength(2);
    const testEntry = result.find((r) => r.key === TEST_DB);
    expect(testEntry?.info?.db_name).toBe(TEST_DB);
  });

  // ── getMembership ────────────────────────────────────────────────────────

  itSkip("getMembership returns node lists", async () => {
    const membership = await client.getMembership();
    expect(Array.isArray(membership.all_nodes)).toBe(true);
    expect(Array.isArray(membership.cluster_nodes)).toBe(true);
  });
});
