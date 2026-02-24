import { Command } from "commander";
import pc from "picocolors";
import { LocalRuntime } from "../lib/local-runtime.js";

export const LocalCommand = new Command("local")
  .description("Manage local CouchDB instance")
  .option("-v, --version <version>", "CouchDB version", "3.3.3")
  .option("-p, --port <port>", "Port to bind", "5984")
  .option("--admin <user>", "Admin username", "admin")
  .option("--password <pass>", "Admin password", "password");

LocalCommand
  .command("up")
  .description("Start local CouchDB")
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.opts() || {};
    const runtime = new LocalRuntime({
      version: parentOpts.version,
      port: parseInt(parentOpts.port),
      adminUser: parentOpts.admin,
      adminPass: parentOpts.password,
    });
    
    console.log(pc.cyan("🛋️ Starting local CouchDB..."));
    
    try {
      const url = await runtime.start();
      console.log(pc.green(`✓ CouchDB ${parentOpts.version} running`));
      console.log(pc.dim(`  URL: ${url}`));
      console.log(pc.dim(`  Admin: ${parentOpts.admin} / ${parentOpts.password}`));
    } catch (error) {
      console.error(pc.red(`Failed to start: ${error.message}`));
      process.exit(1);
    }
  });

LocalCommand
  .command("down")
  .description("Stop local CouchDB")
  .action(async () => {
    const runtime = new LocalRuntime();
    console.log(pc.cyan("🛑 Stopping local CouchDB..."));
    
    try {
      await runtime.stop();
      console.log(pc.green("✓ CouchDB stopped"));
    } catch (error) {
      console.error(pc.red(`Failed to stop: ${error.message}`));
      process.exit(1);
    }
  });

LocalCommand
  .command("status")
  .description("Check local CouchDB status")
  .action(async () => {
    const runtime = new LocalRuntime();
    const status = await runtime.status();
    
    if (status.running) {
      console.log(pc.green("✓ CouchDB is running"));
      console.log(pc.dim(`  URL: ${status.url}`));
      console.log(pc.dim(`  PID: ${status.pid}`));
    } else {
      console.log(pc.yellow("○ CouchDB is not running"));
    }
  });