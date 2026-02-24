import { Command } from "commander";
import pc from "picocolors";
import { CouchClient } from "../lib/couch-client.js";
import { ConfigManager } from "../lib/config.js";

export const SearchCommand = new Command("search")
  .description("Full-text search using Nouveau (CouchDB 3.x Lucene-based search)");

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

// ── query ─────────────────────────────────────────────────────────────────────

SearchCommand
  .command("query <ddoc> <index> <query> [db]")
  .description("Query a Nouveau full-text search index")
  .option("--limit <n>", "Max number of results (default 25)")
  .option("--bookmark <token>", "Pagination bookmark from previous response")
  .option("--include-docs", "Include full document bodies")
  .option("--fields <fields>", "Comma-separated fields to return from the index")
  .option("--sort <json>", "Sort spec as JSON (e.g. '[\"-score\"]')")
  .option("--counts <fields>", "Comma-separated facet count fields")
  .option("--highlight-fields <fields>", "Comma-separated fields to highlight")
  .option("--highlight-pre <tag>", "HTML tag to open highlight (default <em>)")
  .option("--highlight-post <tag>", "HTML tag to close highlight (default </em>)")
  .option("--json", "Output as JSON")
  .action(async (ddoc: string, index: string, query: string, db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const ddocName = ddoc.startsWith("_design/") ? ddoc.slice(8) : ddoc;

      const searchOptions: Parameters<typeof client.nouveauSearch>[4] = {};

      if (options.limit) searchOptions.limit = parseInt(options.limit as string, 10);
      if (options.bookmark) searchOptions.bookmark = options.bookmark as string;
      if (options.includeDocs) searchOptions.include_docs = true;
      if (options.fields) {
        searchOptions.fields = (options.fields as string).split(",").map((f: string) => f.trim());
      }
      if (options.sort) {
        try {
          searchOptions.sort = JSON.parse(options.sort as string);
        } catch {
          throw new Error(`Invalid JSON for --sort: ${options.sort}`);
        }
      }
      if (options.counts) {
        searchOptions.counts = (options.counts as string).split(",").map((f: string) => f.trim());
      }
      if (options.highlightFields) {
        searchOptions.highlight_fields = (options.highlightFields as string)
          .split(",")
          .map((f: string) => f.trim());
      }
      if (options.highlightPre) searchOptions.highlight_pre_tag = options.highlightPre as string;
      if (options.highlightPost) searchOptions.highlight_post_tag = options.highlightPost as string;

      const result = await client.nouveauSearch(name, ddocName, index, query, searchOptions);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        pc.cyan(`🔍 Search "${name}/${ddocName}/${index}"`) +
        pc.dim(` — ${result.total_hits} total hit(s)`)
      );
      console.log(pc.dim(`  query: ${query}`));

      if (result.hits.length === 0) {
        console.log(pc.dim("  (no results)"));
        return;
      }

      for (const hit of result.hits) {
        console.log(`\n  ${pc.blue("▸")} ${pc.bold(hit.id)}`);

        if (hit.fields && Object.keys(hit.fields).length > 0) {
          const entries = Object.entries(hit.fields).slice(0, 5);
          for (const [k, v] of entries) {
            const val = JSON.stringify(v);
            const display = val.length > 60 ? val.slice(0, 57) + "…" : val;
            console.log(`    ${pc.dim(k + ":")} ${display}`);
          }
        }
      }

      if (result.bookmark) {
        console.log(pc.dim(`\n  Next page: --bookmark ${result.bookmark}`));
      }
    } catch (error) {
      // Provide a helpful message if Nouveau is not enabled
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("not_found") || msg.includes("nouveau") || msg.includes("search")) {
        console.error(pc.red(`Error: ${msg}`));
        console.error(pc.dim("  Nouveau search requires CouchDB 3.2+ with search enabled."));
        console.error(pc.dim("  Check if your CouchDB instance has Nouveau configured."));
      } else {
        console.error(pc.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });
