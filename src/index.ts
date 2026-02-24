#!/usr/bin/env bun
import { Command } from "commander";
import pc from "picocolors";
import { LocalCommand } from "./commands/local.js";
import { ConnectCommand } from "./commands/connect.js";
import { DbCommand } from "./commands/db.js";
import { DocCommand } from "./commands/doc.js";
import { ReplCommand } from "./commands/repl.js";

const program = new Command()
  .name("sillon")
  .description("🛋️ Modern CouchDB CLI")
  .version("0.1.0");

// Add commands
program.addCommand(LocalCommand);
program.addCommand(ConnectCommand);
program.addCommand(DbCommand);
program.addCommand(DocCommand);
program.addCommand(ReplCommand);

// Global error handling
program.exitOverride();

try {
  await program.parseAsync();
} catch (error) {
  if (error.code === "commander.help") {
    process.exit(0);
  }
  if (error.code === "commander.version") {
    process.exit(0);
  }
  console.error(pc.red(`Error: ${error.message}`));
  process.exit(1);
}