import { Command } from "commander";
import pc from "picocolors";
import { CouchClient, type MangoQuery } from "../lib/couch-client.js";
import { ConfigManager } from "../lib/config.js";

// ── shared helpers ────────────────────────────────────────────────────────────

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

/** Read all stdin as a string. Errors if stdin is a TTY. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("No JSON provided — pipe JSON to stdin:\n  echo '{...}' | sillon find");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

// ── find ──────────────────────────────────────────────────────────────────────

export const FindCommand = new Command("find")
  .description("Query documents using a Mango selector (reads JSON from stdin)")
  .argument("[db]", "Database name (falls back to current db)")
  .option("--limit <n>", "Max number of results")
  .option("--skip <n>", "Documents to skip")
  .option("--fields <fields>", "Comma-separated list of fields to return")
  .option("--sort <json>", "Sort spec as JSON array, e.g. '[\"name\"]'")
  .option("--index <name>", "Use a specific index (name or ddoc/name)")
  .option("--bookmark <token>", "Pagination bookmark from a previous response")
  .option("--stats", "Include execution statistics")
  .option("--json", "Output as JSON")
  .action(async (db?: string, options?) => {
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

      // Accept either a full MangoQuery object or a bare selector object
      let query: MangoQuery;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "selector" in (parsed as Record<string, unknown>)
      ) {
        query = parsed as MangoQuery;
      } else if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        // Treat it as a bare selector
        query = { selector: parsed as MangoQuery["selector"] };
      } else {
        throw new Error("JSON must be an object with a 'selector' key or a bare selector object");
      }

      // CLI options override fields in the query object
      if (options.limit) query.limit = parseInt(options.limit as string, 10);
      if (options.skip) query.skip = parseInt(options.skip as string, 10);
      if (options.bookmark) query.bookmark = options.bookmark as string;
      if (options.stats) query.execution_stats = true;

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

      if (options.index) {
        query.use_index = options.index as string;
      }

      const result = await client.mangoQuery(name, query);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        pc.cyan(`🔎 "${name}"`) +
        pc.dim(` — ${result.docs.length} result(s)`)
      );

      if (result.warning) {
        console.log(pc.yellow(`  ⚠  ${result.warning}`));
      }

      if (result.docs.length === 0) {
        console.log(pc.dim("  (no results)"));
      } else {
        for (const doc of result.docs) {
          const id = doc._id;
          const rev = doc._rev ? pc.dim(` rev: ${String(doc._rev).slice(0, 10)}…`) : "";
          console.log(`  ${pc.blue("▸")} ${id}${rev}`);

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

      if (result.execution_stats) {
        const s = result.execution_stats;
        console.log(pc.dim(
          `\n  Stats: ${s.results_returned} returned, ` +
          `${s.total_docs_examined} docs examined, ` +
          `${s.execution_time_ms.toFixed(2)}ms`
        ));
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── index ─────────────────────────────────────────────────────────────────────

export const IndexCommand = new Command("index")
  .description("Manage Mango indexes");

// index list

IndexCommand
  .command("list [db]")
  .description("List Mango indexes defined on a database")
  .option("--json", "Output as JSON")
  .action(async (db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();
      const result = await client.listIndexes(name);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(pc.cyan(`📇 Indexes in "${name}"`));
      console.log(pc.dim(`  Total: ${result.total_rows}`));

      for (const idx of result.indexes) {
        const ddocLabel = idx.ddoc ? pc.dim(` (${idx.ddoc})`) : pc.dim(" (special)");
        const fields = idx.def.fields
          .map((f) => {
            const entries = Object.entries(f);
            return entries.map(([k, dir]) => `${k}:${dir}`).join(", ");
          })
          .join(", ");

        console.log(`\n  ${pc.blue("▸")} ${pc.bold(idx.name)}${ddocLabel}`);
        console.log(`    ${pc.dim("type:")}   ${idx.type}`);
        console.log(`    ${pc.dim("fields:")} ${fields || "(none)"}`);
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// index create

IndexCommand
  .command("create [db]")
  .description("Create a Mango index (reads JSON from stdin)")
  .option("--json", "Output response as JSON")
  .action(async (db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const raw = await readStdin();
      let indexDef: unknown;
      try {
        indexDef = JSON.parse(raw);
      } catch {
        throw new Error("Invalid JSON on stdin");
      }

      if (
        indexDef === null ||
        typeof indexDef !== "object" ||
        Array.isArray(indexDef)
      ) {
        throw new Error("JSON must be an object");
      }

      type IndexInput = {
        index: { fields: Array<string | Record<string, "asc" | "desc">> };
        name?: string;
        ddoc?: string;
        type?: "json" | "text";
      };

      // Accept either `{ index: { fields: [...] } }` or a bare `{ fields: [...] }`
      let indexPayload: IndexInput;
      const obj = indexDef as Record<string, unknown>;
      if ("index" in obj) {
        indexPayload = obj as unknown as IndexInput;
      } else if ("fields" in obj) {
        indexPayload = { index: obj as unknown as IndexInput["index"] };
      } else {
        throw new Error(
          "JSON must have an 'index' key with 'fields', e.g.:\n" +
          '  { "index": { "fields": ["name"] }, "name": "by_name" }'
        );
      }

      const result = await client.createIndex(name, indexPayload);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const status = result.result === "created" ? pc.green("✓ Created") : pc.yellow("● Exists");
      console.log(`${status} index "${result.name}"`);
      console.log(`  ${pc.dim("ddoc:")} ${result.id}`);
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// index delete

IndexCommand
  .command("delete <ddoc> <name> [db]")
  .alias("rm")
  .description("Delete a Mango index")
  .action(async (ddoc: string, indexName: string, db?: string) => {
    try {
      const dbName = await resolveDb(db);
      const client = await getClient();
      // Accept both `_design/foo` and bare `foo`
      const ddocId = ddoc.startsWith("_design/") ? ddoc : `_design/${ddoc}`;
      await client.deleteIndex(dbName, ddocId, indexName);
      console.log(pc.green(`✓ Deleted index "${indexName}" from ${ddocId}`));
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
