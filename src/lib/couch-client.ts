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

export class CouchClient {
  private baseUrl: string;

  constructor(url: string) {
    this.baseUrl = url.replace(/\/$/, "");
  }

  private async request(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
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

  // Server operations
  async getServerInfo(): Promise<{
    couchdb: string;
    version: string;
    vendor?: { name: string; version?: string };
  }> {
    const response = await this.request("/");
    return response.json() as Promise<{ couchdb: string; version: string; vendor?: { name: string; version?: string } }>;
  }

  // Database operations
  async listDatabases(): Promise<string[]> {
    const response = await this.request("/_all_dbs");
    return response.json() as Promise<string[]>;
  }

  async createDatabase(
    name: string,
    options: { partitioned?: boolean } = {}
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

  // Document operations
  async getDocument(db: string, id: string): Promise<Document> {
    const response = await this.request(`/${db}/${encodeURIComponent(id)}`);
    return response.json() as Promise<Document>;
  }

  async putDocument(
    db: string,
    doc: Document
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
    rev: string
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    const response = await this.request(
      `/${db}/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`,
      { method: "DELETE" }
    );
    return response.json() as Promise<{ ok: boolean; id: string; rev: string }>;
  }

  // View operations
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
    } = {}
  ): Promise<ViewResult> {
    const params = new URLSearchParams();
    
    if (options.key !== undefined) {
      params.set("key", JSON.stringify(options.key));
    }
    if (options.startkey !== undefined) {
      params.set("startkey", JSON.stringify(options.startkey));
    }
    if (options.endkey !== undefined) {
      params.set("endkey", JSON.stringify(options.endkey));
    }
    if (options.limit !== undefined) {
      params.set("limit", options.limit.toString());
    }
    if (options.skip !== undefined) {
      params.set("skip", options.skip.toString());
    }
    if (options.descending) {
      params.set("descending", "true");
    }
    if (options.include_docs) {
      params.set("include_docs", "true");
    }
    if (options.reduce === false) {
      params.set("reduce", "false");
    }
    if (options.group) {
      params.set("group", "true");
    }
    if (options.group_level !== undefined) {
      params.set("group_level", options.group_level.toString());
    }

    const qs = params.toString();
    const path = `/${db}/_design/${ddoc}/_view/${view}${qs ? "?" + qs : ""}`;
    
    const response = await this.request(path);
    return response.json() as Promise<ViewResult>;
  }

  // Replication
  async replicate(
    source: string,
    target: string,
    options: {
      continuous?: boolean;
      create_target?: boolean;
      cancel?: boolean;
    } = {}
  ): Promise<{
    ok: boolean;
    session_id?: string;
    source_last_seq?: number;
  }> {
    const body = {
      source,
      target,
      ...options,
    };

    const response = await this.request("/_replicate", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return response.json() as Promise<{ ok: boolean; session_id?: string; source_last_seq?: number }>;
  }

  // Active tasks
  async getActiveTasks(): Promise<unknown[]> {
    const response = await this.request("/_active_tasks");
    return response.json() as Promise<unknown[]>;
  }
}