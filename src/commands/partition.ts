import { Command } from "commander";
import pc from "picocolors";
import { CouchClient, type MangoQuery } from "../lib/couch-client.js";
import { ConfigManager } from "../lib/config.js";

export const PartitionCommand = new Command("partition")
  .description("Partitioned database operations (CouchDB 3.x)");

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveDb(arg?: string): Promise<string> {
  if (arg) return arg;
  const config = new ConfigManager();
  const current = await config.getCurrentDb();
  if (current) return current;
  throw new Error(
    "No database specified.\n  Pass a database name or run: sillon db use <name>"
  );
}

async function getClient(): Promise<CouchClient> {
  const config = new ConfigManager();
  const conn = await config.getActiveConnection();
  return new CouchClient(conn.url);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("No JSON provided — pipe JSON to stdin");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// ── partition info ────────────────────────────────────────────────────────────

PartitionCommand
  .command("info <partition> [db]")
  .description("Show information about a partition")
  .option("--json", "Output as JSON")
  .action(async (partition: string, db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();
      const info = await client.getPartitionInfo(name, partition);

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      console.log(pc.cyan(`🗂️  Partition: ${pc.bold(partition)} in "${name}"`));
      console.log(`  ${pc.dim("Documents:")}      ${info.doc_count}`);
      console.log(`  ${pc.dim("Deleted:")}        ${info.doc_del_count}`);
      console.log(`  ${pc.dim("Size (active):")}  ${formatBytes(info.sizes?.active ?? 0)}`);
      console.log(`  ${pc.dim("Size (ext):")}     ${formatBytes(info.sizes?.external ?? 0)}`);
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── partition list ────────────────────────────────────────────────────────────

PartitionCommand
  .command("list <partition> [db]")
  .description("List documents in a partition")
  .option("--limit <n>", "Max number of results")
  .option("--skip <n>", "Documents to skip")
  .option("--descending", "Reverse order")
  .option("--include-docs", "Include full document bodies")
  .option("--json", "Output as JSON")
  .action(async (partition: string, db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const result = await client.getPartitionDocs(name, partition, {
        limit: options.limit ? parseInt(options.limit as string, 10) : undefined,
        skip: options.skip ? parseInt(options.skip as string, 10) : undefined,
        descending: !!options.descending,
        include_docs: !!options.includeDocs,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const rows = result.rows.filter((r) => !r.value.deleted);
      console.log(
        pc.cyan(`📄 "${name}:${partition}"`) + pc.dim(` — ${result.total_rows} total`)
      );

      if (rows.length === 0) {
        console.log(pc.dim("  (no documents)"));
        return;
      }

      for (const row of rows) {
        const rev = pc.dim(`rev: ${row.value.rev.slice(0, 10)}…`);
        console.log(`  ${pc.blue("▸")} ${row.id}  ${rev}`);
        if (options.includeDocs && row.doc) {
          const keys = Object.keys(row.doc).filter((k) => !k.startsWith("_"));
          if (keys.length > 0) {
            const preview = keys
              .slice(0, 4)
              .map((k) => `${k}: ${JSON.stringify((row.doc as Record<string, unknown>)[k]).slice(0, 20)}`)
              .join(", ");
            console.log(`    ${pc.dim("{ " + preview + (keys.length > 4 ? ", …" : "") + " }")}`);
          }
        }
      }

      if (result.rows.length < result.total_rows) {
        console.log(pc.dim(`\n  Showing ${result.rows.length} of ${result.total_rows}. Use --limit / --skip to paginate.`));
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── partition find ────────────────────────────────────────────────────────────

PartitionCommand
  .command("find <partition> [db]")
  .description("Query a partition using a Mango selector (reads JSON from stdin)")
  .option("--limit <n>", "Max number of results")
  .option("--skip <n>", "Documents to skip")
  .option("--fields <fields>", "Comma-separated list of fields to return")
  .option("--sort <json>", "Sort spec as JSON array")
  .option("--bookmark <token>", "Pagination bookmark")
  .option("--json", "Output as JSON")
  .action(async (partition: string, db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const raw = await readStdin();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("Invalid JSON on stdin");
      }

      let query: MangoQuery;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "selector" in (parsed as Record<string, unknown>)
      ) {
        query = parsed as MangoQuery;
      } else if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        query = { selector: parsed as MangoQuery["selector"] };
      } else {
        throw new Error("JSON must be a selector object or { selector: ... }");
      }

      if (options.limit) query.limit = parseInt(options.limit as string, 10);
      if (options.skip) query.skip = parseInt(options.skip as string, 10);
      if (options.bookmark) query.bookmark = options.bookmark as string;
      if (options.fields) {
        query.fields = (options.fields as string).split(",").map((f: string) => f.trim());
      }
      if (options.sort) {
        try {
          query.sort = JSON.parse(options.sort as string);
        } catch {
          throw new Error(`Invalid JSON for --sort: ${options.sort}`);
        }
      }

      const result = await client.partitionFind(name, partition, query);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        pc.cyan(`🔎 "${name}:${partition}"`) +
        pc.dim(` — ${result.docs.length} result(s)`)
      );

      if (result.warning) console.log(pc.yellow(`  ⚠  ${result.warning}`));

      if (result.docs.length === 0) {
        console.log(pc.dim("  (no results)"));
      } else {
        for (const doc of result.docs) {
          const rev = doc._rev ? pc.dim(` rev: ${String(doc._rev).slice(0, 10)}…`) : "";
          console.log(`  ${pc.blue("▸")} ${doc._id}${rev}`);
          const keys = Object.keys(doc).filter((k) => !k.startsWith("_"));
          if (keys.length > 0) {
            const preview = keys
              .slice(0, 4)
              .map((k) => `${k}: ${JSON.stringify(doc[k]).slice(0, 24)}`)
              .join(", ");
            console.log(`    ${pc.dim("{ " + preview + (keys.length > 4 ? ", …" : "") + " }")}`);
          }
        }
      }

      if (result.bookmark) {
        console.log(pc.dim(`\n  Next page: --bookmark ${result.bookmark}`));
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── partition view ────────────────────────────────────────────────────────────

PartitionCommand
  .command("view <ddoc> <view> <partition> [db]")
  .description("Query a view scoped to a partition")
  .option("--key <json>", "Exact key (JSON)")
  .option("--startkey <json>", "Start of key range (JSON)")
  .option("--endkey <json>", "End of key range (JSON)")
  .option("--limit <n>", "Max rows")
  .option("--skip <n>", "Rows to skip")
  .option("--descending", "Reverse key order")
  .option("--include-docs", "Include full document bodies")
  .option("--reduce", "Force reduce")
  .option("--no-reduce", "Disable reduce")
  .option("--group", "Group by key")
  .option("--group-level <n>", "Group level depth")
  .option("--json", "Output as JSON")
  .action(async (ddoc: string, view: string, partition: string, db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const parseJson = (val: string | undefined, flag: string): unknown => {
        if (val === undefined) return undefined;
        try { return JSON.parse(val); }
        catch { throw new Error(`Invalid JSON for ${flag}: ${val}`); }
      };

      let reduceOpt: boolean | undefined;
      if (options.reduce === false) reduceOpt = false;
      else if (options.reduce === true) reduceOpt = true;

      const ddocName = ddoc.startsWith("_design/") ? ddoc.slice(8) : ddoc;

      const result = await client.queryPartitionView(name, partition, ddocName, view, {
        key: parseJson(options.key as string | undefined, "--key"),
        startkey: parseJson(options.startkey as string | undefined, "--startkey"),
        endkey: parseJson(options.endkey as string | undefined, "--endkey"),
        limit: options.limit ? parseInt(options.limit as string, 10) : undefined,
        skip: options.skip ? parseInt(options.skip as string, 10) : undefined,
        descending: !!options.descending,
        include_docs: !!options.includeDocs,
        reduce: reduceOpt,
        group: !!options.group,
        group_level: options.groupLevel ? parseInt(options.groupLevel as string, 10) : undefined,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const total = result.total_rows !== undefined ? ` — ${result.total_rows} total` : "";
      console.log(pc.cyan(`📊 ${ddocName}/${view}`) + pc.dim(` [partition: ${partition}]${total}`));
      console.log(pc.dim(`  ${result.rows.length} row(s)`));

      if (result.rows.length === 0) {
        console.log(pc.dim("  (no results)"));
        return;
      }

      for (const row of result.rows) {
        console.log(
          `  ${pc.blue("▸")} ${pc.bold(JSON.stringify(row.key))}  ${pc.dim("→")}  ${JSON.stringify(row.value)}`
        );
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
