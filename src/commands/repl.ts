import { Command } from "commander";
import pc from "picocolors";
import { CouchClient, type ReplicationJobDoc } from "../lib/couch-client.js";
import { ConfigManager } from "../lib/config.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function getClient(): Promise<CouchClient> {
  const config = new ConfigManager();
  const conn = await config.getActiveConnection();
  return new CouchClient(conn.url);
}

function sourceUrl(job: ReplicationJobDoc): string {
  return typeof job.source === "string" ? job.source : job.source.url;
}

function targetUrl(job: ReplicationJobDoc): string {
  return typeof job.target === "string" ? job.target : job.target.url;
}

function stateColor(state: string | undefined): string {
  switch (state) {
    case "completed":  return pc.green(state);
    case "triggered":  return pc.cyan(state);
    case "error":      return pc.red(state);
    default:           return pc.dim(state ?? "unknown");
  }
}

// ── root command ──────────────────────────────────────────────────────────────

export const ReplCommand = new Command("repl")
  .description("Replication operations");

// ── repl setup ────────────────────────────────────────────────────────────────

ReplCommand
  .command("setup <source> <target>")
  .description("Trigger a one-time (or continuous) replication via /_replicate")
  .option("-c, --continuous", "Continuous replication")
  .option("--create-target", "Create the target database if it does not exist")
  .option("--filter <fn>", "Filter function (ddoc/name)")
  .option("--doc-ids <ids>", "Comma-separated document IDs to replicate")
  .option("--json", "Output response as JSON")
  .action(async (source: string, target: string, options) => {
    try {
      const client = await getClient();

      const result = await client.replicate(source, target, {
        continuous: options.continuous ?? false,
        create_target: options.createTarget ?? false,
        filter: options.filter as string | undefined,
        doc_ids: options.docIds
          ? (options.docIds as string).split(",").map((s: string) => s.trim())
          : undefined,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(pc.green("✓ Replication started"));
      console.log(`  ${pc.dim("source:")}     ${source}`);
      console.log(`  ${pc.dim("target:")}     ${target}`);
      if (options.continuous) console.log(`  ${pc.dim("mode:")}       continuous`);
      if (result.session_id) console.log(`  ${pc.dim("session:")}    ${result.session_id}`);
      if (result.source_last_seq !== undefined)
        console.log(`  ${pc.dim("last_seq:")}   ${result.source_last_seq}`);
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── repl jobs ─────────────────────────────────────────────────────────────────

ReplCommand
  .command("jobs")
  .description("List persistent replication jobs from _replicator")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getClient();
      const result = await client.listReplicationJobs();

      // Filter out design docs
      const jobs = result.rows.filter((r) => !r.id.startsWith("_design/") && r.doc);

      if (options.json) {
        console.log(JSON.stringify(jobs.map((r) => r.doc), null, 2));
        return;
      }

      console.log(pc.cyan(`🔁 Replication jobs (${jobs.length})`));

      if (jobs.length === 0) {
        console.log(pc.dim("  (none)"));
        return;
      }

      for (const row of jobs) {
        const job = row.doc as unknown as ReplicationJobDoc;
        const state = job._replication_state;
        const continuous = job.continuous ? pc.dim(" [continuous]") : "";
        console.log(`\n  ${pc.blue("▸")} ${pc.bold(job._id)}${continuous}`);
        console.log(`    ${pc.dim("source:")} ${sourceUrl(job)}`);
        console.log(`    ${pc.dim("target:")} ${targetUrl(job)}`);
        if (state) console.log(`    ${pc.dim("state:")}  ${stateColor(state)}`);
        if (job._replication_id) console.log(`    ${pc.dim("rep id:")} ${job._replication_id}`);
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── repl add ──────────────────────────────────────────────────────────────────

ReplCommand
  .command("add <source> <target>")
  .description("Add a persistent replication job to _replicator")
  .option("--id <id>", "Document ID for the job (auto-generated if omitted)")
  .option("-c, --continuous", "Continuous replication")
  .option("--create-target", "Create the target database if it does not exist")
  .option("--filter <fn>", "Filter function (ddoc/name)")
  .option("--doc-ids <ids>", "Comma-separated document IDs to replicate")
  .option("--json", "Output response as JSON")
  .action(async (source: string, target: string, options) => {
    try {
      const client = await getClient();

      // Generate an ID if not provided
      const id = (options.id as string | undefined) ??
        `rep-${source.replace(/[^a-z0-9]/gi, "_")}-to-${target.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}`;

      const job: Omit<ReplicationJobDoc, "_rev"> = {
        _id: id,
        source,
        target,
      };

      if (options.continuous) job.continuous = true;
      if (options.createTarget) job.create_target = true;
      if (options.filter) job.filter = options.filter as string;
      if (options.docIds) {
        job.doc_ids = (options.docIds as string).split(",").map((s: string) => s.trim());
      }

      const result = await client.createReplicationJob(job);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(pc.green(`✓ Replication job "${result.id}" created`));
      console.log(`  ${pc.dim("source:")} ${source}`);
      console.log(`  ${pc.dim("target:")} ${target}`);
      if (options.continuous) console.log(`  ${pc.dim("mode:")}   continuous`);
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── repl cancel ───────────────────────────────────────────────────────────────

ReplCommand
  .command("cancel <id>")
  .description("Cancel (delete) a persistent replication job from _replicator")
  .alias("delete")
  .action(async (id: string) => {
    try {
      const client = await getClient();

      // Fetch the current rev first
      const job = await client.getReplicationJob(id);
      if (!job._rev) {
        throw new Error("Job has no _rev — cannot delete");
      }

      await client.deleteReplicationJob(id, job._rev);
      console.log(pc.green(`✓ Replication job "${id}" cancelled`));
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── repl status ───────────────────────────────────────────────────────────────

ReplCommand
  .command("status")
  .description("Show active replication tasks from /_active_tasks")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getClient();
      const tasks = await client.getReplicationTasks();

      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }

      console.log(pc.cyan(`⚡ Active replication tasks (${tasks.length})`));

      if (tasks.length === 0) {
        console.log(pc.dim("  (none)"));
        return;
      }

      for (const task of tasks) {
        const src = String(task["source"] ?? "?");
        const tgt = String(task["target"] ?? "?");
        const progress = task["progress"] !== undefined ? `${task["progress"]}%` : "";
        const written = task["docs_written"] !== undefined ? ` written: ${task["docs_written"]}` : "";
        const read = task["docs_read"] !== undefined ? ` read: ${task["docs_read"]}` : "";

        console.log(`\n  ${pc.blue("▸")} ${pc.dim("source:")} ${src}`);
        console.log(`    ${pc.dim("target:")} ${tgt}`);
        if (progress) console.log(`    ${pc.dim("progress:")} ${progress}`);
        if (written || read) console.log(`    ${pc.dim("docs:")}    ${read}${written}`);
        if (task["continuous"]) console.log(`    ${pc.dim("mode:")}    continuous`);
        if (task["replication_id"]) console.log(`    ${pc.dim("rep id:")}  ${task["replication_id"]}`);
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── repl conflicts ────────────────────────────────────────────────────────────

ReplCommand
  .command("conflicts <db>")
  .description("List documents with conflicts in a database")
  .option("--limit <n>", "Max documents to check", "100")
  .option("--json", "Output as JSON")
  .action(async (db: string, options) => {
    try {
      const client = await getClient();
      const limit = parseInt(options.limit as string, 10);

      const result = await client.getConflicts(db, { limit });

      // Filter to only docs that actually have conflicts
      type DocWithConflicts = { _id: string; _rev: string; _conflicts?: string[] };
      const conflicted = result.rows
        .filter((r) => r.doc && (r.doc as unknown as DocWithConflicts)._conflicts?.length)
        .map((r) => r.doc as unknown as DocWithConflicts);

      if (options.json) {
        console.log(JSON.stringify(conflicted, null, 2));
        return;
      }

      console.log(pc.cyan(`⚠️  Conflicts in "${db}" (${conflicted.length} documents)`));

      if (conflicted.length === 0) {
        console.log(pc.green("  ✓ No conflicts found"));
        return;
      }

      for (const doc of conflicted) {
        console.log(`\n  ${pc.red("▸")} ${pc.bold(doc._id)}`);
        console.log(`    ${pc.dim("winning rev:")} ${doc._rev}`);
        const conflicts = doc._conflicts ?? [];
        console.log(`    ${pc.dim("conflict revs:")} ${conflicts.length}`);
        for (const rev of conflicts) {
          console.log(`      ${pc.dim("–")} ${rev}`);
        }
      }

      console.log(pc.dim(`\n  Tip: use "sillon doc get <db> <id>" to inspect a conflicted document`));
    } catch (error) {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
