import { Command } from "commander";
import pc from "picocolors";
import { CouchClient, type Document, type ViewResult } from "../lib/couch-client.js";
import { ConfigManager } from "../lib/config.js";

export const ViewCommand = new Command("view")
  .description("Design document & view operations");

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

/** Strip the `_design/` prefix for display purposes. */
function ddocName(id: string): string {
  return id.replace(/^_design\//, "");
}

// ── list ──────────────────────────────────────────────────────────────────────

ViewCommand
  .command("list [db]")
  .description("List design documents and their views")
  .option("--json", "Output as JSON")
  .action(async (db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const result = await client.getDesignDocs(name, true);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const ddocs = result.rows.filter((r) => r.doc && !r.value.deleted);

      console.log(pc.cyan(`🔍 Design documents in "${name}"`));

      if (ddocs.length === 0) {
        console.log(pc.dim("  (no design documents)"));
        return;
      }

      for (const row of ddocs) {
        const doc = row.doc as Document & {
          views?: Record<string, { map: string; reduce?: string }>;
          indexes?: Record<string, unknown>;
          filters?: Record<string, string>;
          updates?: Record<string, string>;
          lists?: Record<string, string>;
          shows?: Record<string, string>;
        };

        console.log(`\n  ${pc.bold(pc.blue(ddocName(row.id)))}`);
        console.log(`  ${pc.dim("rev:")} ${String(doc._rev ?? "").slice(0, 12)}…`);

        if (doc.views && Object.keys(doc.views).length > 0) {
          console.log(`  ${pc.dim("views:")}`);
          for (const [viewName, def] of Object.entries(doc.views)) {
            const hasReduce = !!def.reduce;
            const badge = hasReduce ? pc.yellow(" [map/reduce]") : pc.dim(" [map]");
            console.log(`    ${pc.blue("▸")} ${viewName}${badge}`);
          }
        }

        if (doc.indexes && Object.keys(doc.indexes).length > 0) {
          console.log(`  ${pc.dim("search indexes:")} ${Object.keys(doc.indexes).join(", ")}`);
        }
        if (doc.filters && Object.keys(doc.filters).length > 0) {
          console.log(`  ${pc.dim("filters:")} ${Object.keys(doc.filters).join(", ")}`);
        }
      }

      console.log(pc.dim(`\nTotal: ${ddocs.length} design document(s)`));
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── get ───────────────────────────────────────────────────────────────────────

ViewCommand
  .command("get <ddoc> [db]")
  .description("Show a design document")
  .option("--json", "Output as JSON (default)")
  .action(async (ddoc: string, db?: string, _options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();
      // Accept both `ddoc` and `_design/ddoc` forms
      const docId = ddoc.startsWith("_design/") ? ddoc : `_design/${ddoc}`;
      const doc = await client.getDocument(name, docId);
      console.log(JSON.stringify(doc, null, 2));
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── query ─────────────────────────────────────────────────────────────────────

ViewCommand
  .command("query <ddoc> <view> [db]")
  .description("Query a view")
  .option("--key <json>", "Exact key to match (JSON value)")
  .option("--startkey <json>", "Start of key range (JSON value)")
  .option("--endkey <json>", "End of key range (JSON value)")
  .option("--limit <n>", "Max number of rows")
  .option("--skip <n>", "Rows to skip")
  .option("--descending", "Reverse key order")
  .option("--include-docs", "Include full document bodies")
  .option("--reduce", "Force reduce (true)")
  .option("--no-reduce", "Disable reduce, show map output")
  .option("--group", "Group results by key (enable reduce grouping)")
  .option("--group-level <n>", "Group results up to array depth N")
  .option("--json", "Output as JSON")
  .action(async (ddoc: string, view: string, db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      // Parse JSON key values safely
      const parseJsonOpt = (val: string | undefined, flag: string): unknown => {
        if (val === undefined) return undefined;
        try {
          return JSON.parse(val);
        } catch {
          throw new Error(`Invalid JSON for ${flag}: ${val}`);
        }
      };

      // commander sets options.reduce=false when --no-reduce is used
      let reduceOpt: boolean | undefined;
      if (options.reduce === false) {
        reduceOpt = false; // --no-reduce explicitly passed
      } else if (options.reduce === true) {
        reduceOpt = true; // --reduce explicitly passed
      }
      // if neither, leave as undefined (server default)

      const result: ViewResult = await client.queryView(
        name,
        ddoc.startsWith("_design/") ? ddocName(ddoc) : ddoc,
        view,
        {
          key: parseJsonOpt(options.key as string | undefined, "--key"),
          startkey: parseJsonOpt(options.startkey as string | undefined, "--startkey"),
          endkey: parseJsonOpt(options.endkey as string | undefined, "--endkey"),
          limit: options.limit ? parseInt(options.limit as string, 10) : undefined,
          skip: options.skip ? parseInt(options.skip as string, 10) : undefined,
          descending: !!options.descending,
          include_docs: !!options.includeDocs,
          reduce: reduceOpt,
          group: !!options.group,
          group_level: options.groupLevel ? parseInt(options.groupLevel as string, 10) : undefined,
        }
      );

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const total = result.total_rows !== undefined
        ? ` — ${result.total_rows} total`
        : "";
      console.log(pc.cyan(`📊 ${ddocName(ddoc)}/${view}`) + pc.dim(total));
      console.log(pc.dim(`  ${result.rows.length} row(s)`));

      if (result.rows.length === 0) {
        console.log(pc.dim("  (no results)"));
        return;
      }

      for (const row of result.rows) {
        const keyStr = JSON.stringify(row.key);
        const valStr = JSON.stringify(row.value);
        console.log(
          `  ${pc.blue("▸")} ${pc.bold(keyStr)}  ${pc.dim("→")}  ${valStr}`
        );
        if (row.doc) {
          const keys = Object.keys(row.doc).filter((k) => !k.startsWith("_"));
          if (keys.length > 0) {
            const preview = keys
              .slice(0, 4)
              .map((k) => `${k}: ${JSON.stringify((row.doc as Document)[k]).slice(0, 24)}`)
              .join(", ");
            console.log(`    ${pc.dim("{ " + preview + (keys.length > 4 ? ", …" : "") + " }")}`);
          }
        }
      }

      if (result.total_rows !== undefined && result.rows.length < result.total_rows) {
        console.log(pc.dim(`\n  Use --limit / --skip to paginate.`));
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
