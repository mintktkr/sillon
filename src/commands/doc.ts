import { unlink } from "node:fs/promises";
import { Command } from "commander";
import pc from "picocolors";
import { ConfigManager } from "../lib/config.js";
import { CouchClient, type Document } from "../lib/couch-client.js";

export const DocCommand = new Command("doc").description("Document operations");

// ── helpers ───────────────────────────────────────────────────────────────────

/** Resolve the working database: explicit arg → currentDb → error. */
async function resolveDb(arg?: string): Promise<string> {
  if (arg) return arg;
  const config = new ConfigManager();
  const current = await config.getCurrentDb();
  if (current) return current;
  throw new Error(
    "No database specified.\n  Pass a database name or run: sillon db use <name>",
  );
}

async function getClient(): Promise<CouchClient> {
  const config = new ConfigManager();
  const conn = await config.getActiveConnection();
  return new CouchClient(conn.url);
}

/** Read all stdin as a string. Errors if stdin is a TTY (nothing piped). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      "No JSON provided — pipe JSON to stdin:\n  echo '{...}' | sillon doc put",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** Prompt user for a yes/no answer. Returns true if confirmed. */
async function confirm(question: string): Promise<boolean> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (chunk) => {
      process.stdin.pause();
      input = String(chunk).trim().toLowerCase();
      resolve(input === "y" || input === "yes");
    });
  });
}

/** Open content in $EDITOR via a temp file. Returns the edited string. */
async function editInEditor(content: string): Promise<string> {
  const tmpPath = `/tmp/sillon-edit-${Date.now()}.json`;
  await Bun.write(tmpPath, content);

  const editor = process.env.EDITOR || process.env.VISUAL || "nano";
  const editorArgs = editor.split(" "); // handles e.g. "code --wait"

  const proc = Bun.spawnSync([...editorArgs, tmpPath], {
    stdio: ["inherit", "inherit", "inherit"],
  });

  const edited = await Bun.file(tmpPath).text();

  // Best-effort cleanup
  try {
    await unlink(tmpPath);
  } catch {
    /* ignore */
  }

  if (proc.exitCode !== 0) {
    throw new Error(`Editor exited with code ${proc.exitCode}`);
  }

  return edited.trim();
}

// ── list ──────────────────────────────────────────────────────────────────────

DocCommand.command("list [db]")
  .description("List documents in a database")
  .option("--limit <n>", "Max number of results")
  .option("--skip <n>", "Documents to skip")
  .option("--descending", "Reverse order")
  .option("--include-docs", "Include full document bodies")
  .option("--json", "Output as JSON")
  .action(async (db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const result = await client.getAllDocs(name, {
        limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
        skip: options.skip ? Number.parseInt(options.skip, 10) : undefined,
        descending: !!options.descending,
        include_docs: !!options.includeDocs,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const rows = result.rows.filter((r) => !r.value.deleted);
      console.log(
        pc.cyan(`📄 "${name}"`) + pc.dim(` — ${result.total_rows} total`),
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
              .map(
                (k) =>
                  `${k}: ${JSON.stringify(row.doc?.[k as keyof typeof row.doc]).slice(0, 20)}`,
              )
              .join(", ");
            console.log(
              `    ${pc.dim(`{ ${preview}${keys.length > 4 ? ", …" : ""} }`)}`,
            );
          }
        }
      }

      if (result.rows.length < result.total_rows) {
        const shown = result.rows.length;
        console.log(
          pc.dim(
            `\n  Showing ${shown} of ${result.total_rows}. Use --limit / --skip to paginate.`,
          ),
        );
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

// ── get ───────────────────────────────────────────────────────────────────────

DocCommand.command("get <id> [db]")
  .description("Get a document by ID")
  .option("--json", "Output as JSON (default)")
  .action(async (id: string, db?: string, _options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();
      const doc = await client.getDocument(name, id);
      // Always pretty-print JSON — it's the canonical format for a doc
      console.log(JSON.stringify(doc, null, 2));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── put ───────────────────────────────────────────────────────────────────────

DocCommand.command("put [db]")
  .description("Insert or update a document (reads JSON from stdin)")
  .option("--id <id>", "Override or set document _id")
  .option("--json", "Output response as JSON")
  .action(async (db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const raw = await readStdin();
      let doc: Record<string, unknown>;
      try {
        doc = JSON.parse(raw);
      } catch {
        throw new Error("Invalid JSON on stdin");
      }

      if (typeof doc !== "object" || Array.isArray(doc) || doc === null) {
        throw new Error(
          "JSON must be an object ({}), not an array or primitive",
        );
      }

      // --id flag overrides _id in the JSON
      if (options.id) doc._id = options.id;

      let result: { ok: boolean; id: string; rev: string };

      if (doc._id) {
        // PUT — upsert with explicit ID
        result = await client.putDocument(name, doc as Document);
      } else {
        // POST — server assigns a UUID
        result = await client.createDocument(name, doc);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(pc.green("✓ Document saved"));
      console.log(`  ${pc.dim("id:")}  ${result.id}`);
      console.log(`  ${pc.dim("rev:")} ${result.rev}`);
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── edit ──────────────────────────────────────────────────────────────────────

DocCommand.command("edit <id> [db]")
  .description("Edit a document in $EDITOR")
  .action(async (id: string, db?: string) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      // Fetch current document
      const doc = await client.getDocument(name, id);
      const original = JSON.stringify(doc, null, 2);

      // Launch editor
      const edited = await editInEditor(original);

      if (edited === original) {
        console.log(pc.dim("No changes made."));
        return;
      }

      let updatedDoc: Record<string, unknown>;
      try {
        updatedDoc = JSON.parse(edited);
      } catch {
        throw new Error("Invalid JSON after editing — document not saved");
      }

      // Preserve _id / _rev from original if not present in edited version
      if (!updatedDoc._id) updatedDoc._id = doc._id;
      if (!updatedDoc._rev) updatedDoc._rev = doc._rev;

      const result = await client.putDocument(name, updatedDoc as Document);
      console.log(pc.green("✓ Document updated"));
      console.log(`  ${pc.dim("id:")}  ${result.id}`);
      console.log(`  ${pc.dim("rev:")} ${result.rev}`);
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

DocCommand.command("delete <id> [db]")
  .alias("rm")
  .description("Delete a document")
  .option("-f, --force", "Skip confirmation")
  .action(async (id: string, db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      // Fetch the document first to get its current _rev
      const doc = await client.getDocument(name, id);

      if (!options.force) {
        const ok = await confirm(
          pc.yellow(`Delete "${id}" from "${name}"? [y/N] `),
        );
        if (!ok) {
          console.log(pc.dim("Aborted."));
          return;
        }
      }

      if (!doc._rev) throw new Error(`Document "${id}" has no _rev`);
      await client.deleteDocument(name, id, doc._rev);
      console.log(pc.green(`✓ Deleted "${id}"`));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

// ── purge ─────────────────────────────────────────────────────────────────────

DocCommand.command("purge <id> [db]")
  .description(
    "Permanently purge specific revisions of a document (CouchDB 3.x)",
  )
  .option(
    "--rev <revs>",
    "Comma-separated revision(s) to purge. Defaults to current _rev.",
  )
  .option("--json", "Output response as JSON")
  .action(async (id: string, db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      let revs: string[];

      if (options.rev) {
        revs = (options.rev as string).split(",").map((r: string) => r.trim());
      } else {
        // Fetch the document to get its current _rev
        const doc = await client.getDocument(name, id);
        if (!doc._rev) throw new Error("Document has no _rev — cannot purge");
        revs = [doc._rev];
      }

      console.log(pc.yellow("⚠️  Purge permanently removes revision history."));
      const result = await client.purge(name, { [id]: revs });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const purgedRevs = result.purged?.[id] ?? [];
      if (purgedRevs.length > 0) {
        console.log(
          pc.green(`✓ Purged "${id}" (${purgedRevs.length} revision(s))`),
        );
        for (const rev of purgedRevs) {
          console.log(`  ${pc.dim("–")} ${rev}`);
        }
      } else {
        console.log(pc.dim(`No revisions purged for "${id}"`));
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

// ── bulk-get ──────────────────────────────────────────────────────────────────

DocCommand.command("bulk-get [db]")
  .description(
    "Fetch multiple documents by ID (reads JSON array of IDs from stdin)",
  )
  .option("--include-docs", "Include full document bodies in response")
  .option("--json", "Output as JSON")
  .action(async (db?: string, options?) => {
    try {
      const name = await resolveDb(db);
      const client = await getClient();

      const raw = await readStdin();
      let ids: unknown;
      try {
        ids = JSON.parse(raw);
      } catch {
        throw new Error(
          "Invalid JSON on stdin — expected an array of document IDs",
        );
      }

      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
        throw new Error("JSON must be an array of strings (document IDs)");
      }

      const result = await client.getAllDocs(name, {
        keys: ids as string[],
        include_docs: !!options.includeDocs,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        pc.cyan(`📦 Bulk fetch "${name}"`) +
          pc.dim(` — ${result.rows.length} row(s)`),
      );

      for (const row of result.rows) {
        if ("error" in row.value) {
          console.log(`  ${pc.red("✗")} ${row.id} — ${pc.dim("not found")}`);
        } else {
          const rev = pc.dim(`rev: ${row.value.rev.slice(0, 10)}…`);
          console.log(`  ${pc.blue("▸")} ${row.id}  ${rev}`);
          if (options.includeDocs && row.doc) {
            const keys = Object.keys(row.doc).filter((k) => !k.startsWith("_"));
            if (keys.length > 0) {
              const preview = keys
                .slice(0, 4)
                .map(
                  (k) =>
                    `${k}: ${JSON.stringify((row.doc as Record<string, unknown>)[k]).slice(0, 20)}`,
                )
                .join(", ");
              console.log(
                `    ${pc.dim(`{ ${preview}${keys.length > 4 ? ", …" : ""} }`)}`,
              );
            }
          }
        }
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
