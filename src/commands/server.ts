import { Command } from "commander";
import pc from "picocolors";
import { CouchClient } from "../lib/couch-client.js";
import { ConfigManager } from "../lib/config.js";

export const ServerCommand = new Command("server")
  .description("Server information and cluster management");

// ── helpers ───────────────────────────────────────────────────────────────────

async function getClient(): Promise<CouchClient> {
  const config = new ConfigManager();
  const conn = await config.getActiveConnection();
  return new CouchClient(conn.url);
}

// ── info ──────────────────────────────────────────────────────────────────────

ServerCommand
  .command("info")
  .description("Show CouchDB server information")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getClient();
      const info = await client.getServerInfo();

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      console.log(pc.cyan("🛋️  CouchDB Server"));
      console.log(`  ${pc.dim("status:")}  ${info.couchdb}`);
      console.log(`  ${pc.dim("version:")} ${pc.bold(info.version)}`);
      if (info.vendor) {
        console.log(`  ${pc.dim("vendor:")}  ${info.vendor.name}${info.vendor.version ? ` ${info.vendor.version}` : ""}`);
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── membership ────────────────────────────────────────────────────────────────

ServerCommand
  .command("membership")
  .description("Show cluster node membership")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getClient();
      const membership = await client.getMembership();

      if (options.json) {
        console.log(JSON.stringify(membership, null, 2));
        return;
      }

      console.log(pc.cyan("🌐 Cluster Membership"));

      console.log(`\n  ${pc.dim("Cluster nodes:")} (${membership.cluster_nodes.length})`);
      for (const node of membership.cluster_nodes) {
        const inAll = membership.all_nodes.includes(node);
        const marker = inAll ? pc.green("●") : pc.yellow("○");
        console.log(`    ${marker} ${node}`);
      }

      const outsiders = membership.all_nodes.filter(
        (n) => !membership.cluster_nodes.includes(n)
      );
      if (outsiders.length > 0) {
        console.log(`\n  ${pc.dim("All nodes (not in cluster):")} (${outsiders.length})`);
        for (const node of outsiders) {
          console.log(`    ${pc.yellow("○")} ${node}`);
        }
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── tasks ─────────────────────────────────────────────────────────────────────

ServerCommand
  .command("tasks")
  .description("Show active background tasks")
  .option("--type <type>", "Filter by task type (e.g. replication, indexer)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getClient();
      let tasks = await client.getActiveTasks() as Array<Record<string, unknown>>;

      if (options.type) {
        tasks = tasks.filter((t) => t["type"] === options.type);
      }

      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }

      const typeFilter = options.type ? ` [${options.type}]` : "";
      console.log(pc.cyan(`⚡ Active Tasks${typeFilter} (${tasks.length})`));

      if (tasks.length === 0) {
        console.log(pc.dim("  (none)"));
        return;
      }

      for (const task of tasks) {
        const type = String(task["type"] ?? "unknown");
        const node = task["node"] ? pc.dim(` on ${task["node"]}`) : "";
        console.log(`\n  ${pc.blue("▸")} ${pc.bold(type)}${node}`);

        if (task["database"]) console.log(`    ${pc.dim("database:")}  ${task["database"]}`);
        if (task["design_document"]) console.log(`    ${pc.dim("ddoc:")}      ${task["design_document"]}`);
        if (task["progress"] !== undefined) {
          const pct = Number(task["progress"]);
          const bar = buildBar(pct, 20);
          console.log(`    ${pc.dim("progress:")}  ${bar} ${pct}%`);
        }
        if (task["started_on"]) {
          const ts = new Date(Number(task["started_on"]) * 1000).toLocaleTimeString();
          console.log(`    ${pc.dim("started:")}   ${ts}`);
        }
        // Replication-specific
        if (task["source"]) console.log(`    ${pc.dim("source:")}    ${task["source"]}`);
        if (task["target"]) console.log(`    ${pc.dim("target:")}    ${task["target"]}`);
        if (task["docs_written"] !== undefined)
          console.log(`    ${pc.dim("written:")}   ${task["docs_written"]}`);
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── scheduler ─────────────────────────────────────────────────────────────────

ServerCommand
  .command("scheduler")
  .description("Show replication scheduler state (jobs and docs)")
  .option("--docs", "Show scheduler docs instead of running jobs")
  .option("--limit <n>", "Max results to show")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getClient();
      const limit = options.limit ? parseInt(options.limit as string, 10) : undefined;

      if (options.docs) {
        const result = await client.getSchedulerDocs({ limit });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(pc.cyan(`📋 Scheduler Docs (${result.total_rows} total)`));

        if (result.docs.length === 0) {
          console.log(pc.dim("  (none)"));
          return;
        }

        for (const doc of result.docs) {
          const stateColor = scheduleStateColor(doc.state);
          console.log(`\n  ${pc.blue("▸")} ${pc.bold(doc.id)}`);
          console.log(`    ${pc.dim("state:")}    ${stateColor}`);
          console.log(`    ${pc.dim("source:")}   ${doc.source}`);
          console.log(`    ${pc.dim("target:")}   ${doc.target}`);
          if (doc.error_count > 0)
            console.log(`    ${pc.dim("errors:")}   ${pc.red(String(doc.error_count))}`);
          if (doc.last_updated)
            console.log(`    ${pc.dim("updated:")}  ${doc.last_updated}`);
        }
      } else {
        const result = await client.getSchedulerJobs({ limit });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(pc.cyan(`⚙️  Scheduler Jobs (${result.total_rows} total, ${result.jobs.length} shown)`));

        if (result.jobs.length === 0) {
          console.log(pc.dim("  (none)"));
          return;
        }

        for (const job of result.jobs) {
          console.log(`\n  ${pc.blue("▸")} ${pc.bold(job.id)}`);
          console.log(`    ${pc.dim("source:")}  ${job.source}`);
          console.log(`    ${pc.dim("target:")}  ${job.target}`);
          if (job.node) console.log(`    ${pc.dim("node:")}    ${job.node}`);
          if (job.start_time) console.log(`    ${pc.dim("started:")} ${job.start_time}`);

          const lastEvent = job.history?.[0];
          if (lastEvent) {
            console.log(`    ${pc.dim("last:")}    ${lastEvent.type}${lastEvent.reason ? " – " + lastEvent.reason : ""}`);
          }
        }
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── stats ─────────────────────────────────────────────────────────────────────

ServerCommand
  .command("stats")
  .description("Show node statistics")
  .option("--node <node>", "Node name (default: _local)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getClient();
      const node = (options.node as string | undefined) ?? "_local";
      const stats = await client.getNodeStats(node);

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(pc.cyan(`📈 Node Stats: ${node}`));

      // Show a curated subset — full stats are huge
      const httpd = (stats as Record<string, unknown>)["httpd"] as Record<string, unknown> | undefined;
      const couchdb = (stats as Record<string, unknown>)["couchdb"] as Record<string, unknown> | undefined;

      if (httpd) {
        const requests = (httpd["requests"] as Record<string, unknown> | undefined);
        const bulkRequests = (httpd["bulk_requests"] as Record<string, unknown> | undefined);
        if (requests) console.log(`  ${pc.dim("httpd.requests:")}      ${(requests["value"] as number) ?? 0}`);
        if (bulkRequests) console.log(`  ${pc.dim("httpd.bulk_requests:")} ${(bulkRequests["value"] as number) ?? 0}`);
      }

      if (couchdb) {
        const openDbs = (couchdb["open_databases"] as Record<string, unknown> | undefined);
        const openFiles = (couchdb["open_os_files"] as Record<string, unknown> | undefined);
        if (openDbs) console.log(`  ${pc.dim("couchdb.open_dbs:")}    ${(openDbs["value"] as number) ?? 0}`);
        if (openFiles) console.log(`  ${pc.dim("couchdb.open_files:")}  ${(openFiles["value"] as number) ?? 0}`);
      }

      console.log(pc.dim("\n  Tip: use --json for full stats"));
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── helpers ───────────────────────────────────────────────────────────────────

function buildBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return pc.green("█".repeat(filled)) + pc.dim("░".repeat(empty));
}

function scheduleStateColor(state: string): string {
  switch (state) {
    case "running":    return pc.green(state);
    case "completed":  return pc.cyan(state);
    case "failed":
    case "error":      return pc.red(state);
    case "pending":    return pc.yellow(state);
    default:           return pc.dim(state);
  }
}
