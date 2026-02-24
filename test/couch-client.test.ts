import { describe, it, expect, beforeAll } from "bun:test";
import { CouchClient } from "../src/lib/couch-client";

const TEST_DB = "sillon-test-db";
const COUCH_URL = process.env.COUCHDB_URL || "http://admin:password@localhost:5984";

describe("CouchClient", () => {
  let client: CouchClient;

  beforeAll(async () => {
    client = new CouchClient(COUCH_URL);
    
    // Clean up test DB if exists
    try {
      await client.deleteDatabase(TEST_DB);
    } catch {
      // Ignore if doesn't exist
    }
  });

  it("should connect to server", async () => {
    const info = await client.getServerInfo();
    expect(info.couchdb).toBe("Welcome");
    expect(info.version).toBeTruthy();
  });

  it("should list databases", async () => {
    const dbs = await client.listDatabases();
    expect(Array.isArray(dbs)).toBe(true);
  });

  it("should create a database", async () => {
    const result = await client.createDatabase(TEST_DB);
    expect(result.ok).toBe(true);
    
    // Cleanup
    await client.deleteDatabase(TEST_DB);
  });

  it("should get database info", async () => {
    await client.createDatabase(TEST_DB);
    
    const info = await client.getDatabaseInfo(TEST_DB);
    expect(info.db_name).toBe(TEST_DB);
    expect(info.doc_count).toBe(0);
    
    await client.deleteDatabase(TEST_DB);
  });

  it("should create and get a document", async () => {
    await client.createDatabase(TEST_DB);
    
    const doc = {
      _id: "test-doc",
      name: "Test Document",
      value: 42,
    };
    
    const putResult = await client.putDocument(TEST_DB, doc);
    expect(putResult.ok).toBe(true);
    expect(putResult.id).toBe("test-doc");
    expect(putResult.rev).toBeTruthy();
    
    const getResult = await client.getDocument(TEST_DB, "test-doc");
    expect(getResult._id).toBe("test-doc");
    expect(getResult.name).toBe("Test Document");
    expect(getResult.value).toBe(42);
    
    await client.deleteDatabase(TEST_DB);
  });
});
