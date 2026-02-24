import { Command } from "commander";
import pc from "picocolors";
import { ConfigManager } from "../lib/config.js";
import { CouchClient } from "../lib/couch-client.js";

export const DbCommand = new Command("db").description("Database operations");

// ── helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/** Read a single line from stdin. Returns trimmed string. */
async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (chunk) => {
      process.stdin.pause();
      input = String(chunk).trim();
      resolve(input);
    });
  });
}

async function getClient(): Promise<{
  client: CouchClient;
  config: ConfigManager;
}> {
  const config = new ConfigManager();
  const conn = await config.getActiveConnection();
  return { client: new CouchClient(conn.url), config };
}

// ── list ──────────────────────────────────────────────────────────────────────

DbCommand.command("list")
  .description("List all databases")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const { client } = await getClient();
      const dbs = await client.listDatabases();

      if (options.json) {
        console.log(JSON.stringify(dbs, null, 2));
        return;
      }

      console.log(pc.cyan("📁 Databases:"));
      for (const db of dbs) {
        console.log(`  ${pc.blue("▸")} ${db}`);
      }
      console.log(pc.dim(`\nTotal: ${dbs.length} databases`));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── create ────────────────────────────────────────────────────────────────────

DbCommand.command("create <name>")
  .description("Create a new database")
  .option("--partitioned", "Create as partitioned database")
  .action(async (name: string, options) => {
    try {
      const { client } = await getClient();
      await client.createDatabase(name, { partitioned: options.partitioned });
      console.log(pc.green(`✓ Created database "${name}"`));
      if (options.partitioned) {
        console.log(pc.dim("  (partitioned)"));
      }
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── delete ────────────────────────────────────────────────────────────────────

DbCommand.command("delete <name>")
  .alias("rm")
  .description("Delete a database")
  .option("-f, --force", "Skip confirmation prompt")
  .action(async (name: string, options) => {
    if (!options.force) {
      console.log(
        pc.yellow(
          `⚠️  This will permanently delete "${name}" and all its documents.`,
        ),
      );
      const answer = await prompt(`Type the database name to confirm: `);
      if (answer !== name) {
        console.log(pc.dim("Aborted."));
        return;
      }
    }

    try {
      const { client } = await getClient();
      await client.deleteDatabase(name);
      console.log(pc.green(`✓ Deleted database "${name}"`));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── info ──────────────────────────────────────────────────────────────────────

DbCommand.command("info [name]")
  .description("Show database information")
  .option("--json", "Output as JSON")
  .action(async (name?: string, options?) => {
    // Fall back to current db if no name given
    if (!name) {
      const config = new ConfigManager();
      name = await config.getCurrentDb();
    }

    if (!name) {
      console.log(pc.yellow("Usage: sillon db info <name>"));
      console.log(pc.dim("  Or set a default with: sillon db use <name>"));
      return;
    }

    try {
      const { client } = await getClient();
      const info = await client.getDatabaseInfo(name);

      if (options?.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      console.log(pc.cyan(`📊 Database: ${pc.bold(name)}`));
      console.log(`  ${pc.dim("Documents:")}       ${info.doc_count}`);
      console.log(`  ${pc.dim("Deleted:")}         ${info.doc_del_count}`);
      console.log(
        `  ${pc.dim("Size (active):")}   ${formatBytes(info.sizes?.active ?? 0)}`,
      );
      console.log(
        `  ${pc.dim("Size (external):")} ${formatBytes(info.sizes?.external ?? 0)}`,
      );
      console.log(`  ${pc.dim("Update seq:")}      ${info.update_seq}`);

      if (info.props?.partitioned) {
        console.log(`  ${pc.dim("Type:")}            partitioned`);
      }
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── use ───────────────────────────────────────────────────────────────────────

DbCommand.command("use [name]")
  .description("Set (or show) the current working database")
  .action(async (name?: string) => {
    const config = new ConfigManager();

    if (!name) {
      // Show current
      const current = await config.getCurrentDb();
      if (current) {
        console.log(`${pc.green("●")} Current database: ${pc.cyan(current)}`);
      } else {
        console.log(pc.yellow("○ No current database set"));
        console.log(pc.dim("  Run: sillon db use <name>"));
      }
      return;
    }

    // Verify the database exists before persisting
    try {
      const { client } = await getClient();
      await client.getDatabaseInfo(name);
      await config.setCurrentDb(name);
      console.log(pc.green(`✓ Current database set to "${name}"`));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── compact ───────────────────────────────────────────────────────────────────

DbCommand.command("compact <name>")
  .description(
    "Trigger compaction for a database (or a design doc's view index)",
  )
  .option("--ddoc <ddoc>", "Compact a specific design document view index")
  .action(async (name: string, options) => {
    try {
      const { client } = await getClient();

      if (options.ddoc) {
        await client.compactView(name, options.ddoc);
        console.log(
          pc.green(
            `✓ View compaction started for "${name}/_design/${options.ddoc}"`,
          ),
        );
      } else {
        await client.compact(name);
        console.log(pc.green(`✓ Compaction started for "${name}"`));
      }

      console.log(pc.dim("  Compaction runs in the background."));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── view-cleanup ──────────────────────────────────────────────────────────────

DbCommand.command("view-cleanup <name>")
  .description("Clean up unreferenced view index files for a database")
  .action(async (name: string) => {
    try {
      const { client } = await getClient();
      await client.viewCleanup(name);
      console.log(pc.green(`✓ View cleanup started for "${name}"`));
      console.log(pc.dim("  Cleanup runs in the background."));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });
