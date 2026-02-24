export interface DatabaseInfo {
  db_name: string;
  doc_count: number;
  doc_del_count: number;
  update_seq: string | number;
  sizes?: {
    active: number;
    external: number;
    file: number;
  };
  props?: {
    partitioned?: boolean;
  };
}

export interface Document {
  _id: string;
  _rev?: string;
  [key: string]: unknown;
}

export interface ViewRow {
  id: string;
  key: unknown;
  value: unknown;
  doc?: Document;
}

export interface ViewResult {
  total_rows?: number;
  offset?: number;
  rows: ViewRow[];
}

export interface AllDocsRow {
  id: string;
  key: string;
  value: { rev: string; deleted?: boolean };
  doc?: Document;
}

export interface AllDocsResult {
  total_rows: number;
  offset: number;
  rows: AllDocsRow[];
}

export interface AllDocsOptions {
  startkey?: string;
  endkey?: string;
  keys?: string[];
  limit?: number;
  skip?: number;
  descending?: boolean;
  include_docs?: boolean;
  inclusive_end?: boolean;
  conflicts?: boolean;
}

export interface ReplicationJobDoc {
  _id: string;
  _rev?: string;
  source: string | { url: string };
  target: string | { url: string };
  continuous?: boolean;
  create_target?: boolean;
  filter?: string;
  query_params?: Record<string, unknown>;
  doc_ids?: string[];
  _replication_state?: "triggered" | "completed" | "error";
  _replication_state_time?: string;
  _replication_id?: string;
}

export interface BulkDocsResult {
  ok?: boolean;
  id: string;
  rev?: string;
  error?: string;
  reason?: string;
}

export interface MangoSelector {
  [key: string]: unknown;
}

export interface MangoQuery {
  selector: MangoSelector;
  fields?: string[];
  sort?: Array<string | Record<string, "asc" | "desc">>;
  limit?: number;
  skip?: number;
  bookmark?: string;
  use_index?: string | string[];
  execution_stats?: boolean;
}

export interface MangoResult {
  docs: Document[];
  bookmark?: string;
  warning?: string;
  execution_stats?: {
    total_keys_examined: number;
    total_docs_examined: number;
    total_quorum_docs_examined: number;
    results_returned: number;
    execution_time_ms: number;
  };
}

export interface MangoIndex {
  ddoc: string | null;
  name: string;
  type: string;
  def: { fields: Array<Record<string, "asc" | "desc">> };
}

export interface MangoIndexResult {
  total_rows: number;
  indexes: MangoIndex[];
}

export interface NouveauSearchResult {
  total_hits: number;
  hits: Array<{
    id: string;
    order: unknown[];
    fields?: Record<string, unknown>;
  }>;
  bookmark?: string;
}

export interface SchedulerJob {
  id: string;
  database: string;
  doc_id: string;
  node: string;
  pid: string;
  source: string;
  target: string;
  start_time: string;
  last_updated: string;
  history: Array<{ type: string; timestamp: string; reason?: string }>;
  info?: Record<string, unknown>;
}

export interface SchedulerDoc {
  id: string;
  database: string;
  node: string;
  source: string;
  target: string;
  state: string;
  info?: Record<string, unknown>;
  start_time: string | null;
  last_updated: string;
  error_count: number;
}

export class CouchClient {
  private baseUrl: string;
  private authHeader?: string;

  constructor(url: string) {
    const parsed = new URL(url);
    this.baseUrl = `${parsed.protocol}//${parsed.host}`;
    
    // Extract credentials and create Basic Auth header
    if (parsed.username || parsed.password) {
      const creds = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
      this.authHeader = `Basic ${btoa(creds)}`;
    }
  }

  private async request(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    };
    
    // Add auth header if we have credentials
    if (this.authHeader) {
      headers.Authorization = this.authHeader;
    }
    
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      let message: string;
      try {
        const error = JSON.parse(text);
        message = error.reason || error.error || text;
      } catch {
        message = text || `HTTP ${response.status}`;
      }
      throw new Error(message);
    }

    return response;
  }

  // ── Server operations ─────────────────────────────────────────────────────

  async getServerInfo(): Promise<{
    couchdb: string;
    version: string;
    vendor?: { name: string; version?: string };
  }> {
    const response = await this.request("/");
    return response.json() as Promise<{
      couchdb: string;
      version: string;
      vendor?: { name: string; version?: string };
    }>;
  }

  async getActiveTasks(): Promise<unknown[]> {
    const response = await this.request("/_active_tasks");
    return response.json() as Promise<unknown[]>;
  }

  // ── Database operations ───────────────────────────────────────────────────

  async listDatabases(): Promise<string[]> {
    const response = await this.request("/_all_dbs");
    return response.json() as Promise<string[]>;
  }

  async createDatabase(
    name: string,
    options: { partitioned?: boolean } = {},
  ): Promise<{ ok: boolean }> {
    const qs = options.partitioned ? "?partitioned=true" : "";
    const response = await this.request(`/${name}${qs}`, { method: "PUT" });
    return response.json() as Promise<{ ok: boolean }>;
  }

  async deleteDatabase(name: string): Promise<{ ok: boolean }> {
    const response = await this.request(`/${name}`, { method: "DELETE" });
    return response.json() as Promise<{ ok: boolean }>;
  }

  async getDatabaseInfo(name: string): Promise<DatabaseInfo> {
    const response = await this.request(`/${name}`);
    return response.json() as Promise<DatabaseInfo>;
  }

  /** Trigger compaction for a database. */
  async compact(db: string): Promise<{ ok: boolean }> {
    const response = await this.request(`/${db}/_compact`, { method: "POST" });
    return response.json() as Promise<{ ok: boolean }>;
  }

  /** Trigger compaction for a specific design document's view index. */
  async compactView(db: string, ddoc: string): Promise<{ ok: boolean }> {
    const response = await this.request(`/${db}/_compact/${ddoc}`, {
      method: "POST",
    });
    return response.json() as Promise<{ ok: boolean }>;
  }

  /** Cleanup unreferenced view index files. */
  async viewCleanup(db: string): Promise<{ ok: boolean }> {
    const response = await this.request(`/${db}/_view_cleanup`, {
      method: "POST",
    });
    return response.json() as Promise<{ ok: boolean }>;
  }

  // ── Document operations ───────────────────────────────────────────────────

  /**
   * Fetch all documents from _all_docs. Pass `include_docs: true` to get
   * the full document bodies. Filter by key range or specific keys list.
   */
  async getAllDocs(
    db: string,
    options: AllDocsOptions = {},
  ): Promise<AllDocsResult> {
    const { keys, ...queryOptions } = options;

    if (keys) {
      // POST form: fetch specific keys
      const params = new URLSearchParams();
      if (queryOptions.include_docs) params.set("include_docs", "true");

      const qs = params.toString();
      const path = `/${db}/_all_docs${qs ? "?" + qs : ""}`;
      const response = await this.request(path, {
        method: "POST",
        body: JSON.stringify({ keys }),
      });
      return response.json() as Promise<AllDocsResult>;
    }

    // GET form
    const params = new URLSearchParams();
    if (queryOptions.startkey !== undefined)
      params.set("startkey", JSON.stringify(queryOptions.startkey));
    if (queryOptions.endkey !== undefined)
      params.set("endkey", JSON.stringify(queryOptions.endkey));
    if (queryOptions.limit !== undefined)
      params.set("limit", queryOptions.limit.toString());
    if (queryOptions.skip !== undefined)
      params.set("skip", queryOptions.skip.toString());
    if (queryOptions.descending) params.set("descending", "true");
    if (queryOptions.include_docs) params.set("include_docs", "true");
    if (queryOptions.inclusive_end === false)
      params.set("inclusive_end", "false");
    if (queryOptions.conflicts) params.set("conflicts", "true");

    const qs = params.toString();
    const response = await this.request(
      `/${db}/_all_docs${qs ? "?" + qs : ""}`,
    );
    return response.json() as Promise<AllDocsResult>;
  }

  /**
   * List only design documents for a database.
   * Uses the _all_docs startkey/endkey trick for the `_design/` namespace.
   */
  async getDesignDocs(db: string, includeDocs = false): Promise<AllDocsResult> {
    return this.getAllDocs(db, {
      startkey: "_design/",
      endkey: "_design0",
      include_docs: includeDocs,
    });
  }

  async getDocument(db: string, id: string): Promise<Document> {
    const response = await this.request(`/${db}/${encodeURIComponent(id)}`);
    return response.json() as Promise<Document>;
  }

  /**
   * Create a document with an auto-generated ID (POST to db root).
   * Returns the server-assigned id and rev.
   */
  async createDocument(
    db: string,
    doc: Omit<Document, "_id"> & { _id?: string },
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    const response = await this.request(`/${db}`, {
      method: "POST",
      body: JSON.stringify(doc),
    });
    return response.json() as Promise<{ ok: boolean; id: string; rev: string }>;
  }

  async putDocument(
    db: string,
    doc: Document,
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    const id = encodeURIComponent(doc._id);
    const response = await this.request(`/${db}/${id}`, {
      method: "PUT",
      body: JSON.stringify(doc),
    });
    return response.json() as Promise<{ ok: boolean; id: string; rev: string }>;
  }

  async deleteDocument(
    db: string,
    id: string,
    rev: string,
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    const response = await this.request(
      `/${db}/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`,
      { method: "DELETE" },
    );
    return response.json() as Promise<{ ok: boolean; id: string; rev: string }>;
  }

  /**
   * Insert, update, or delete multiple documents in one request.
   * Set `_deleted: true` on a doc to delete it (must include `_rev`).
   */
  async bulkDocs(
    db: string,
    docs: Array<Document | (Document & { _deleted: true })>,
    options: { new_edits?: boolean } = {},
  ): Promise<BulkDocsResult[]> {
    const body: Record<string, unknown> = { docs };
    if (options.new_edits === false) body.new_edits = false;

    const response = await this.request(`/${db}/_bulk_docs`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return response.json() as Promise<BulkDocsResult[]>;
  }

  // ── View operations ───────────────────────────────────────────────────────

  async queryView(
    db: string,
    ddoc: string,
    view: string,
    options: {
      key?: unknown;
      startkey?: unknown;
      endkey?: unknown;
      limit?: number;
      skip?: number;
      descending?: boolean;
      include_docs?: boolean;
      reduce?: boolean;
      group?: boolean;
      group_level?: number;
    } = {},
  ): Promise<ViewResult> {
    const params = new URLSearchParams();

    if (options.key !== undefined)
      params.set("key", JSON.stringify(options.key));
    if (options.startkey !== undefined)
      params.set("startkey", JSON.stringify(options.startkey));
    if (options.endkey !== undefined)
      params.set("endkey", JSON.stringify(options.endkey));
    if (options.limit !== undefined)
      params.set("limit", options.limit.toString());
    if (options.skip !== undefined) params.set("skip", options.skip.toString());
    if (options.descending) params.set("descending", "true");
    if (options.include_docs) params.set("include_docs", "true");
    if (options.reduce === false) params.set("reduce", "false");
    if (options.group) params.set("group", "true");
    if (options.group_level !== undefined)
      params.set("group_level", options.group_level.toString());

    const qs = params.toString();
    const path = `/${db}/_design/${ddoc}/_view/${view}${qs ? "?" + qs : ""}`;

    const response = await this.request(path);
    return response.json() as Promise<ViewResult>;
  }

  // ── Mango / _find ─────────────────────────────────────────────────────────

  /**
   * Run a Mango selector query against a database.
   */
  async mangoQuery(db: string, query: MangoQuery): Promise<MangoResult> {
    const response = await this.request(`/${db}/_find`, {
      method: "POST",
      body: JSON.stringify(query),
    });
    return response.json() as Promise<MangoResult>;
  }

  /** List Mango indexes defined on a database. */
  async listIndexes(db: string): Promise<MangoIndexResult> {
    const response = await this.request(`/${db}/_index`);
    return response.json() as Promise<MangoIndexResult>;
  }

  /** Create a Mango index. */
  async createIndex(
    db: string,
    index: {
      index: { fields: Array<string | Record<string, "asc" | "desc">> };
      name?: string;
      ddoc?: string;
      type?: "json" | "text";
    },
  ): Promise<{ result: string; id: string; name: string }> {
    const response = await this.request(`/${db}/_index`, {
      method: "POST",
      body: JSON.stringify(index),
    });
    return response.json() as Promise<{
      result: string;
      id: string;
      name: string;
    }>;
  }

  /** Delete a Mango index. */
  async deleteIndex(
    db: string,
    ddoc: string,
    name: string,
  ): Promise<{ ok: boolean }> {
    const response = await this.request(`/${db}/_index/${ddoc}/json/${name}`, {
      method: "DELETE",
    });
    return response.json() as Promise<{ ok: boolean }>;
  }

  // ── Replication ───────────────────────────────────────────────────────────

  async replicate(
    source: string,
    target: string,
    options: {
      continuous?: boolean;
      create_target?: boolean;
      cancel?: boolean;
      filter?: string;
      query_params?: Record<string, unknown>;
      doc_ids?: string[];
    } = {},
  ): Promise<{
    ok: boolean;
    session_id?: string;
    source_last_seq?: number;
  }> {
    const body = { source, target, ...options };

    const response = await this.request("/_replicate", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return response.json() as Promise<{
      ok: boolean;
      session_id?: string;
      source_last_seq?: number;
    }>;
  }

  /** List documents in _replicator database. */
  async listReplicationJobs(): Promise<AllDocsResult> {
    return this.getAllDocs("_replicator", { include_docs: true });
  }

  /** Get a single replication job document from _replicator. */
  async getReplicationJob(id: string): Promise<ReplicationJobDoc> {
    const response = await this.request(
      `/_replicator/${encodeURIComponent(id)}`,
    );
    return response.json() as Promise<ReplicationJobDoc>;
  }

  /** Add a persistent replication job to _replicator. */
  async createReplicationJob(
    job: Omit<ReplicationJobDoc, "_rev">,
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    const id = encodeURIComponent(job._id);
    const response = await this.request(`/_replicator/${id}`, {
      method: "PUT",
      body: JSON.stringify(job),
    });
    return response.json() as Promise<{ ok: boolean; id: string; rev: string }>;
  }

  /** Delete (cancel) a persistent replication job from _replicator. */
  async deleteReplicationJob(
    id: string,
    rev: string,
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    const response = await this.request(
      `/_replicator/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`,
      { method: "DELETE" },
    );
    return response.json() as Promise<{ ok: boolean; id: string; rev: string }>;
  }

  /** Get active replication tasks from /_active_tasks. */
  async getReplicationTasks(): Promise<Array<Record<string, unknown>>> {
    const tasks = (await this.getActiveTasks()) as Array<
      Record<string, unknown>
    >;
    return tasks.filter((t) => t["type"] === "replication");
  }

  /** List conflicted documents in a database. */
  async getConflicts(
    db: string,
    options: { limit?: number } = {},
  ): Promise<AllDocsResult> {
    return this.getAllDocs(db, {
      include_docs: true,
      conflicts: true,
      limit: options.limit,
    });
  }

  // ── Purge (CouchDB 3.x) ───────────────────────────────────────────────────

  /**
   * Permanently purge specific document revisions.
   * `docsRevs` maps document IDs to arrays of revision strings to purge.
   */
  async purge(
    db: string,
    docsRevs: Record<string, string[]>,
  ): Promise<{ purged: Record<string, string[]>; purge_seq: string }> {
    const response = await this.request(`/${db}/_purge`, {
      method: "POST",
      body: JSON.stringify(docsRevs),
    });
    return response.json() as Promise<{
      purged: Record<string, string[]>;
      purge_seq: string;
    }>;
  }

  /** Get the current purged infos limit (number of purged entries to retain). */
  async getPurgedInfosLimit(db: string): Promise<number> {
    const response = await this.request(`/${db}/_purged_infos_limit`);
    return response.json() as Promise<number>;
  }

  /** Set the purged infos limit for a database. */
  async setPurgedInfosLimit(
    db: string,
    limit: number,
  ): Promise<{ ok: boolean }> {
    const response = await this.request(`/${db}/_purged_infos_limit`, {
      method: "PUT",
      body: JSON.stringify(limit),
    });
    return response.json() as Promise<{ ok: boolean }>;
  }

  // ── Partitioned databases (CouchDB 3.x) ──────────────────────────────────

  /** Get info about a specific partition of a partitioned database. */
  async getPartitionInfo(
    db: string,
    partition: string,
  ): Promise<{
    db_name: string;
    partition: string;
    doc_count: number;
    doc_del_count: number;
    sizes: { active: number; external: number };
  }> {
    const response = await this.request(
      `/${db}/_partition/${encodeURIComponent(partition)}`,
    );
    return response.json() as Promise<{
      db_name: string;
      partition: string;
      doc_count: number;
      doc_del_count: number;
      sizes: { active: number; external: number };
    }>;
  }

  /** List all documents in a specific partition. */
  async getPartitionDocs(
    db: string,
    partition: string,
    options: Omit<AllDocsOptions, "startkey" | "endkey" | "keys"> = {},
  ): Promise<AllDocsResult> {
    const params = new URLSearchParams();
    if (options.limit !== undefined)
      params.set("limit", options.limit.toString());
    if (options.skip !== undefined) params.set("skip", options.skip.toString());
    if (options.descending) params.set("descending", "true");
    if (options.include_docs) params.set("include_docs", "true");

    const qs = params.toString();
    const path = `/${db}/_partition/${encodeURIComponent(partition)}/_all_docs${qs ? "?" + qs : ""}`;
    const response = await this.request(path);
    return response.json() as Promise<AllDocsResult>;
  }

  /** Query a view scoped to a specific partition. */
  async queryPartitionView(
    db: string,
    partition: string,
    ddoc: string,
    view: string,
    options: {
      limit?: number;
      skip?: number;
      descending?: boolean;
      include_docs?: boolean;
      reduce?: boolean;
      group?: boolean;
      group_level?: number;
      startkey?: unknown;
      endkey?: unknown;
      key?: unknown;
    } = {},
  ): Promise<ViewResult> {
    const params = new URLSearchParams();
    if (options.key !== undefined)
      params.set("key", JSON.stringify(options.key));
    if (options.startkey !== undefined)
      params.set("startkey", JSON.stringify(options.startkey));
    if (options.endkey !== undefined)
      params.set("endkey", JSON.stringify(options.endkey));
    if (options.limit !== undefined)
      params.set("limit", options.limit.toString());
    if (options.skip !== undefined) params.set("skip", options.skip.toString());
    if (options.descending) params.set("descending", "true");
    if (options.include_docs) params.set("include_docs", "true");
    if (options.reduce === false) params.set("reduce", "false");
    if (options.group) params.set("group", "true");
    if (options.group_level !== undefined)
      params.set("group_level", options.group_level.toString());

    const qs = params.toString();
    const path = `/${db}/_partition/${encodeURIComponent(partition)}/_design/${ddoc}/_view/${view}${qs ? "?" + qs : ""}`;
    const response = await this.request(path);
    return response.json() as Promise<ViewResult>;
  }

  /** Run a Mango query scoped to a specific partition. */
  async partitionFind(
    db: string,
    partition: string,
    query: MangoQuery,
  ): Promise<MangoResult> {
    const response = await this.request(
      `/${db}/_partition/${encodeURIComponent(partition)}/_find`,
      { method: "POST", body: JSON.stringify(query) },
    );
    return response.json() as Promise<MangoResult>;
  }

  // ── Nouveau search (CouchDB 3.x / Lucene) ────────────────────────────────

  /** Query a Nouveau full-text search index. */
  async nouveauSearch(
    db: string,
    ddoc: string,
    index: string,
    query: string,
    options: {
      limit?: number;
      bookmark?: string;
      include_docs?: boolean;
      fields?: string[];
      sort?: string | string[];
      counts?: string[];
      ranges?: Record<string, unknown>;
      highlight_fields?: string[];
      highlight_pre_tag?: string;
      highlight_post_tag?: string;
      highlight_number?: number;
    } = {},
  ): Promise<NouveauSearchResult> {
    const body: Record<string, unknown> = { q: query, ...options };
    const response = await this.request(
      `/${db}/_design/${ddoc}/_nouveau/${index}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return response.json() as Promise<NouveauSearchResult>;
  }

  // ── Scheduler (CouchDB 3.x) ───────────────────────────────────────────────

  /** List running replication jobs from the scheduler. */
  async getSchedulerJobs(
    options: { limit?: number; skip?: number } = {},
  ): Promise<{
    total_rows: number;
    offset: number;
    jobs: SchedulerJob[];
  }> {
    const params = new URLSearchParams();
    if (options.limit !== undefined)
      params.set("limit", options.limit.toString());
    if (options.skip !== undefined) params.set("skip", options.skip.toString());
    const qs = params.toString();
    const response = await this.request(
      `/_scheduler/jobs${qs ? "?" + qs : ""}`,
    );
    return response.json() as Promise<{
      total_rows: number;
      offset: number;
      jobs: SchedulerJob[];
    }>;
  }

  /** List replication documents from the scheduler. */
  async getSchedulerDocs(
    options: { limit?: number; skip?: number; replicator?: string } = {},
  ): Promise<{
    total_rows: number;
    offset: number;
    docs: SchedulerDoc[];
  }> {
    const params = new URLSearchParams();
    if (options.limit !== undefined)
      params.set("limit", options.limit.toString());
    if (options.skip !== undefined) params.set("skip", options.skip.toString());
    const db = options.replicator ?? "_replicator";
    const qs = params.toString();
    const response = await this.request(
      `/_scheduler/docs/${db}${qs ? "?" + qs : ""}`,
    );
    return response.json() as Promise<{
      total_rows: number;
      offset: number;
      docs: SchedulerDoc[];
    }>;
  }

  // ── Cluster / membership (CouchDB 3.x) ───────────────────────────────────

  /** Get the cluster membership (all_nodes / cluster_nodes). */
  async getMembership(): Promise<{
    all_nodes: string[];
    cluster_nodes: string[];
  }> {
    const response = await this.request("/_membership");
    return response.json() as Promise<{
      all_nodes: string[];
      cluster_nodes: string[];
    }>;
  }

  /** Get cluster setup state. */
  async getClusterSetup(): Promise<{ state: string }> {
    const response = await this.request("/_cluster_setup");
    return response.json() as Promise<{ state: string }>;
  }

  /** Get node info (defaults to local node). */
  async getNodeInfo(node = "_local"): Promise<Record<string, unknown>> {
    const response = await this.request(`/_node/${node}`);
    return response.json() as Promise<Record<string, unknown>>;
  }

  /** Get node stats. */
  async getNodeStats(node = "_local"): Promise<Record<string, unknown>> {
    const response = await this.request(`/_node/${node}/_stats`);
    return response.json() as Promise<Record<string, unknown>>;
  }

  /** Get node system info (memory, processes, etc.). */
  async getNodeSystem(node = "_local"): Promise<Record<string, unknown>> {
    const response = await this.request(`/_node/${node}/_system`);
    return response.json() as Promise<Record<string, unknown>>;
  }

  /** Get bulk info for a list of databases. */
  async getDbsInfo(
    keys: string[],
  ): Promise<Array<{ key: string; info?: DatabaseInfo; error?: string }>> {
    const response = await this.request("/_dbs_info", {
      method: "POST",
      body: JSON.stringify({ keys }),
    });
    return response.json() as Promise<
      Array<{ key: string; info?: DatabaseInfo; error?: string }>
    >;
  }
}
