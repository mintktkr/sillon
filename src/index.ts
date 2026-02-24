#!/usr/bin/env bun
import { Command } from "commander";
import pc from "picocolors";
import { ConnectCommand } from "./commands/connect.js";
import { DbCommand } from "./commands/db.js";
import { DocCommand } from "./commands/doc.js";
import { FindCommand, IndexCommand } from "./commands/find.js";
import { LocalCommand } from "./commands/local.js";
import { PartitionCommand } from "./commands/partition.js";
import { ReplCommand } from "./commands/repl.js";
import { SearchCommand } from "./commands/search.js";
import { ServerCommand } from "./commands/server.js";
import { ViewCommand } from "./commands/view.js";

const program = new Command()
  .name("sillon")
  .description("🛋️ Modern CouchDB CLI")
  .version("0.1.0");

// Add commands
program.addCommand(LocalCommand);
program.addCommand(ConnectCommand);
program.addCommand(DbCommand);
program.addCommand(DocCommand);
program.addCommand(ViewCommand);
program.addCommand(FindCommand);
program.addCommand(IndexCommand);
program.addCommand(ReplCommand);
program.addCommand(ServerCommand);
program.addCommand(PartitionCommand);
program.addCommand(SearchCommand);

// Global error handling
program.exitOverride();

try {
  await program.parseAsync();
} catch (error) {
  const err = error as { code?: string; message?: string };
  if (err.code === "commander.help") {
    process.exit(0);
  }
  if (err.code === "commander.version") {
    process.exit(0);
  }
  console.error(pc.red(`Error: ${err.message ?? String(error)}`));
  process.exit(1);
}
