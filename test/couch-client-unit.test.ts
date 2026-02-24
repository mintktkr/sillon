/**
 * Unit tests for CouchClient - no live CouchDB required.
 * Uses fetch mocking to verify URL construction, query-string encoding,
 * and error handling without network I/O.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CouchClient } from "../src/lib/couch-client";

// ── Fetch mock infrastructure ────────────────────────────────────────────────

type MockResponse = {
  ok: boolean;
  status?: number;
  body?: unknown;
  text?: string;
};

const capturedRequests: Array<{ url: string; options: RequestInit }> = [];
const mockQueue: MockResponse[] = [];

const originalFetch = globalThis.fetch;

function enqueueMock(resp: MockResponse) {
  mockQueue.push(resp);
}

function makeResponse(resp: MockResponse): Response {
  const body =
    resp.text ?? (resp.body !== undefined ? JSON.stringify(resp.body) : "");
  return new Response(body, {
    status: resp.status ?? (resp.ok ? 200 : 500),
    headers: { "Content-Type": "application/json" },
  });
}

function lastReq(): { url: string; options: RequestInit } {
  const req = capturedRequests[capturedRequests.length - 1];
  if (!req) throw new Error("No captured requests");
  return req;
}

function clearCaptures() {
  capturedRequests.length = 0;
}

const mockFetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const url =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : String(input);
  capturedRequests.push({ url, options: init ?? {} });
  const queued = mockQueue.shift();
  if (queued) return makeResponse(queued);
  return makeResponse({ ok: true, body: {} });
};

beforeAll(() => {
  // @ts-expect-error - Bun's fetch type requires `preconnect` but we're mocking it
  globalThis.fetch = mockFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CouchClient (unit)", () => {
  const BASE = "http://couch.local:5984";
  const BASE_WITH_CREDS = "http://admin:pass@couch.local:5984";
  let client: CouchClient;

  beforeAll(() => {
    client = new CouchClient(BASE_WITH_CREDS);
  });

  // ── Constructor normalizes trailing slash ─────────────────────────────────

  it("strips trailing slash from base URL", async () => {
    clearCaptures();
    const c = new CouchClient("http://couch.local:5984/");
    enqueueMock({ ok: true, body: { couchdb: "Welcome", version: "3.3.3" } });
    await c.getServerInfo();
    // URL should not have a double slash
    expect(lastReq().url).toBe("http://couch.local:5984/");
  });

  // ── getServerInfo ─────────────────────────────────────────────────────────

  it("getServerInfo hits root path", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { couchdb: "Welcome", version: "3.3.3" } });
    const info = await client.getServerInfo();
    expect(lastReq().url).toBe(`${BASE}/`);
    expect(info.couchdb).toBe("Welcome");
  });

  // ── listDatabases ─────────────────────────────────────────────────────────

  it("listDatabases hits /_all_dbs", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: ["_users", "_replicator", "mydb"] });
    const dbs = await client.listDatabases();
    expect(lastReq().url).toBe(`${BASE}/_all_dbs`);
    expect(dbs).toContain("mydb");
  });

  // ── createDatabase ────────────────────────────────────────────────────────

  it("createDatabase sends PUT /<name>", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true } });
    await client.createDatabase("testdb");
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/testdb`);
    expect(req.options.method).toBe("PUT");
  });

  it("createDatabase with partitioned=true adds query param", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true } });
    await client.createDatabase("partdb", { partitioned: true });
    expect(lastReq().url).toBe(`${BASE}/partdb?partitioned=true`);
  });

  // ── deleteDatabase ────────────────────────────────────────────────────────

  it("deleteDatabase sends DELETE /<name>", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true } });
    await client.deleteDatabase("testdb");
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/testdb`);
    expect(req.options.method).toBe("DELETE");
  });

  // ── getDatabaseInfo ───────────────────────────────────────────────────────

  it("getDatabaseInfo sends GET /<name>", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { db_name: "mydb", doc_count: 5 } });
    const info = await client.getDatabaseInfo("mydb");
    expect(lastReq().url).toBe(`${BASE}/mydb`);
    expect(info.db_name).toBe("mydb");
  });

  // ── getDocument ───────────────────────────────────────────────────────────

  it("getDocument encodes special characters in ID", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { _id: "my doc/1", _rev: "1-abc" } });
    await client.getDocument("mydb", "my doc/1");
    expect(lastReq().url).toBe(`${BASE}/mydb/my%20doc%2F1`);
  });

  it("getDocument hits /<db>/<id>", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { _id: "doc1", _rev: "1-abc", value: 1 } });
    const doc = await client.getDocument("mydb", "doc1");
    expect(lastReq().url).toBe(`${BASE}/mydb/doc1`);
    expect(doc._id).toBe("doc1");
  });

  // ── putDocument ───────────────────────────────────────────────────────────

  it("putDocument sends PUT with JSON body", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true, id: "doc1", rev: "1-abc" } });
    await client.putDocument("mydb", { _id: "doc1", name: "test" });
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/doc1`);
    expect(req.options.method).toBe("PUT");
    expect(JSON.parse(req.options.body as string)).toMatchObject({
      _id: "doc1",
      name: "test",
    });
  });

  // ── createDocument ────────────────────────────────────────────────────────

  it("createDocument sends POST to db root", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true, id: "gen-id", rev: "1-xyz" } });
    await client.createDocument("mydb", { type: "auto" });
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb`);
    expect(req.options.method).toBe("POST");
  });

  // ── deleteDocument ────────────────────────────────────────────────────────

  it("deleteDocument sends DELETE with rev param", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true, id: "doc1", rev: "2-abc" } });
    await client.deleteDocument("mydb", "doc1", "1-abc");
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/doc1?rev=1-abc`);
    expect(req.options.method).toBe("DELETE");
  });

  // ── getAllDocs ────────────────────────────────────────────────────────────

  it("getAllDocs with no options hits /_all_docs", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 0, offset: 0, rows: [] } });
    await client.getAllDocs("mydb");
    expect(lastReq().url).toBe(`${BASE}/mydb/_all_docs`);
  });

  it("getAllDocs serializes limit/skip/include_docs as query params", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 5, offset: 1, rows: [] } });
    await client.getAllDocs("mydb", { limit: 10, skip: 1, include_docs: true });
    const url = new URL(lastReq().url);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("skip")).toBe("1");
    expect(url.searchParams.get("include_docs")).toBe("true");
  });

  it("getAllDocs with startkey/endkey JSON-encodes the values", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 0, offset: 0, rows: [] } });
    await client.getAllDocs("mydb", { startkey: "a", endkey: "z" });
    const url = new URL(lastReq().url);
    expect(url.searchParams.get("startkey")).toBe('"a"');
    expect(url.searchParams.get("endkey")).toBe('"z"');
  });

  it("getAllDocs with keys uses POST _all_docs", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 2, offset: 0, rows: [] } });
    await client.getAllDocs("mydb", { keys: ["a", "b"] });
    const req = lastReq();
    expect(req.options.method).toBe("POST");
    const body = JSON.parse(req.options.body as string) as { keys: string[] };
    expect(body.keys).toEqual(["a", "b"]);
  });

  it("getAllDocs with descending=true adds param", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 0, offset: 0, rows: [] } });
    await client.getAllDocs("mydb", { descending: true });
    const url = new URL(lastReq().url);
    expect(url.searchParams.get("descending")).toBe("true");
  });

  // ── bulkDocs ──────────────────────────────────────────────────────────────

  it("bulkDocs sends POST to /_bulk_docs with docs array", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: [{ ok: true, id: "a", rev: "1-x" }] });
    await client.bulkDocs("mydb", [{ _id: "a", val: 1 }]);
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/_bulk_docs`);
    expect(req.options.method).toBe("POST");
    const body = JSON.parse(req.options.body as string) as { docs: unknown[] };
    expect(body.docs).toHaveLength(1);
  });

  it("bulkDocs sends new_edits=false when specified", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: [] });
    await client.bulkDocs("mydb", [], { new_edits: false });
    const body = JSON.parse(lastReq().options.body as string) as {
      new_edits: boolean;
    };
    expect(body.new_edits).toBe(false);
  });

  // ── queryView ─────────────────────────────────────────────────────────────

  it("queryView hits /<db>/_design/<ddoc>/_view/<view>", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { rows: [] } });
    await client.queryView("mydb", "myddoc", "myview");
    expect(lastReq().url).toBe(`${BASE}/mydb/_design/myddoc/_view/myview`);
  });

  it("queryView with reduce=false adds param", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { rows: [] } });
    await client.queryView("mydb", "ddoc", "view", { reduce: false });
    const url = new URL(lastReq().url);
    expect(url.searchParams.get("reduce")).toBe("false");
  });

  it("queryView with group=true adds param", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { rows: [] } });
    await client.queryView("mydb", "ddoc", "view", { group: true });
    const url = new URL(lastReq().url);
    expect(url.searchParams.get("group")).toBe("true");
  });

  it("queryView with key JSON-encodes the value", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { rows: [] } });
    await client.queryView("mydb", "ddoc", "view", { key: "hello" });
    const url = new URL(lastReq().url);
    expect(url.searchParams.get("key")).toBe('"hello"');
  });

  // ── mangoQuery ────────────────────────────────────────────────────────────

  it("mangoQuery sends POST to /<db>/_find", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { docs: [] } });
    await client.mangoQuery("mydb", { selector: { type: "user" } });
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/_find`);
    expect(req.options.method).toBe("POST");
    const body = JSON.parse(req.options.body as string) as {
      selector: unknown;
    };
    expect(body.selector).toEqual({ type: "user" });
  });

  // ── createIndex ───────────────────────────────────────────────────────────

  it("createIndex sends POST to /<db>/_index", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { result: "created", id: "x", name: "y" } });
    await client.createIndex("mydb", {
      index: { fields: ["name"] },
      name: "name-idx",
    });
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/_index`);
    expect(req.options.method).toBe("POST");
  });

  // ── deleteIndex ───────────────────────────────────────────────────────────

  it("deleteIndex sends DELETE to /<db>/_index/<ddoc>/json/<name>", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true } });
    await client.deleteIndex("mydb", "my-ddoc", "my-index");
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/_index/my-ddoc/json/my-index`);
    expect(req.options.method).toBe("DELETE");
  });

  // ── replicate ────────────────────────────────────────────────────────────

  it("replicate sends POST to /_replicate", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true } });
    await client.replicate("http://source:5984/db", "http://target:5984/db");
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/_replicate`);
    expect(req.options.method).toBe("POST");
    const body = JSON.parse(req.options.body as string) as {
      source: string;
      target: string;
    };
    expect(body.source).toBe("http://source:5984/db");
    expect(body.target).toBe("http://target:5984/db");
  });

  // ── purge ────────────────────────────────────────────────────────────────

  it("purge sends POST to /<db>/_purge", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { purged: {}, purge_seq: "0-g1AAAABx" } });
    await client.purge("mydb", { doc1: ["1-abc"] });
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/_purge`);
    expect(req.options.method).toBe("POST");
    const body = JSON.parse(req.options.body as string) as Record<
      string,
      string[]
    >;
    expect(body["doc1"]).toEqual(["1-abc"]);
  });

  // ── getPartitionInfo ──────────────────────────────────────────────────────

  it("getPartitionInfo hits /<db>/_partition/<partition>", async () => {
    clearCaptures();
    enqueueMock({
      ok: true,
      body: {
        db_name: "mydb",
        partition: "US",
        doc_count: 10,
        doc_del_count: 0,
      },
    });
    await client.getPartitionInfo("mydb", "US");
    expect(lastReq().url).toBe(`${BASE}/mydb/_partition/US`);
  });

  it("getPartitionInfo URL-encodes the partition key", async () => {
    clearCaptures();
    enqueueMock({
      ok: true,
      body: {
        db_name: "mydb",
        partition: "north/west",
        doc_count: 0,
        doc_del_count: 0,
      },
    });
    await client.getPartitionInfo("mydb", "north/west");
    expect(lastReq().url).toBe(`${BASE}/mydb/_partition/north%2Fwest`);
  });

  // ── compact ───────────────────────────────────────────────────────────────

  it("compact sends POST to /<db>/_compact", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true } });
    await client.compact("mydb");
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/_compact`);
    expect(req.options.method).toBe("POST");
  });

  it("compactView sends POST to /<db>/_compact/<ddoc>", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true } });
    await client.compactView("mydb", "myddoc");
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/_compact/myddoc`);
    expect(req.options.method).toBe("POST");
  });

  it("viewCleanup sends POST to /<db>/_view_cleanup", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { ok: true } });
    await client.viewCleanup("mydb");
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/mydb/_view_cleanup`);
    expect(req.options.method).toBe("POST");
  });

  // ── getMembership ────────────────────────────────────────────────────────

  it("getMembership hits /_membership", async () => {
    clearCaptures();
    enqueueMock({
      ok: true,
      body: {
        all_nodes: ["node1@127.0.0.1"],
        cluster_nodes: ["node1@127.0.0.1"],
      },
    });
    await client.getMembership();
    expect(lastReq().url).toBe(`${BASE}/_membership`);
  });

  // ── getSchedulerJobs ─────────────────────────────────────────────────────

  it("getSchedulerJobs hits /_scheduler/jobs", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 0, offset: 0, jobs: [] } });
    await client.getSchedulerJobs();
    expect(lastReq().url).toBe(`${BASE}/_scheduler/jobs`);
  });

  it("getSchedulerJobs with limit/skip adds query params", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 0, offset: 0, jobs: [] } });
    await client.getSchedulerJobs({ limit: 5, skip: 10 });
    const url = new URL(lastReq().url);
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("skip")).toBe("10");
  });

  // ── getSchedulerDocs ─────────────────────────────────────────────────────

  it("getSchedulerDocs defaults to /_replicator namespace", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 0, offset: 0, docs: [] } });
    await client.getSchedulerDocs();
    expect(lastReq().url).toBe(`${BASE}/_scheduler/docs/_replicator`);
  });

  it("getSchedulerDocs uses custom replicator db when specified", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: { total_rows: 0, offset: 0, docs: [] } });
    await client.getSchedulerDocs({ replicator: "my-replicator" });
    expect(lastReq().url).toBe(`${BASE}/_scheduler/docs/my-replicator`);
  });

  // ── getDbsInfo ───────────────────────────────────────────────────────────

  it("getDbsInfo sends POST to /_dbs_info with keys", async () => {
    clearCaptures();
    enqueueMock({ ok: true, body: [{ key: "mydb", info: {} }] });
    await client.getDbsInfo(["mydb", "_users"]);
    const req = lastReq();
    expect(req.url).toBe(`${BASE}/_dbs_info`);
    expect(req.options.method).toBe("POST");
    const body = JSON.parse(req.options.body as string) as { keys: string[] };
    expect(body.keys).toEqual(["mydb", "_users"]);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("throws with CouchDB reason message on error response", async () => {
    clearCaptures();
    enqueueMock({
      ok: false,
      status: 409,
      body: { error: "conflict", reason: "Document update conflict." },
    });
    await expect(client.putDocument("mydb", { _id: "x" })).rejects.toThrow(
      "Document update conflict.",
    );
  });

  it("throws with plain text when body is unparseable", async () => {
    clearCaptures();
    const origFetch = globalThis.fetch;
    // @ts-expect-error - Bun's fetch type requires `preconnect` but we're mocking it
    globalThis.fetch = async () =>
      new Response("not json at all", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    await expect(client.listDatabases()).rejects.toThrow("not json at all");
    globalThis.fetch = origFetch;
  });

  it("throws with error field when reason is absent", async () => {
    clearCaptures();
    enqueueMock({
      ok: false,
      status: 404,
      body: { error: "not_found" },
    });
    await expect(client.getDocument("mydb", "missing")).rejects.toThrow(
      "not_found",
    );
  });
});
