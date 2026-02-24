import { Command } from "commander";
import pc from "picocolors";
import { ConfigManager } from "../lib/config.js";
import { LocalRuntime } from "../lib/local-runtime.js";

export const LocalCommand = new Command("local")
  .description("Manage local CouchDB instance")
  .option("-v, --version <version>", "CouchDB version", "3.3.3")
  .option("-p, --port <port>", "Port to bind", "5984")
  .option("--admin <user>", "Admin username", "admin")
  .option("--password <pass>", "Admin password", "password");

LocalCommand.command("up")
  .description("Start local CouchDB")
  .option("--no-connect", "Skip saving as default connection")
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.opts() ?? {};
    const runtime = new LocalRuntime({
      version: parentOpts.version,
      port: Number.parseInt(parentOpts.port),
      adminUser: parentOpts.admin,
      adminPass: parentOpts.password,
    });

    console.log(pc.cyan("🛋️  Starting local CouchDB..."));

    try {
      const url = await runtime.start();
      console.log(pc.green(`✓ CouchDB ${parentOpts.version} running`));
      console.log(pc.dim(`  URL:   ${url}`));
      console.log(
        pc.dim(`  Admin: ${parentOpts.admin} / ${parentOpts.password}`),
      );

      // Automatically save as default connection so db/doc commands work immediately
      if (options.connect !== false) {
        const config = new ConfigManager();
        await config.setDefaultConnection(url);
        console.log(pc.dim("  Saved as default connection"));
      }
    } catch (error) {
      console.error(
        pc.red(
          `Failed to start: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

LocalCommand.command("down")
  .description("Stop local CouchDB")
  .action(async () => {
    const runtime = new LocalRuntime();
    console.log(pc.cyan("🛑 Stopping local CouchDB..."));

    try {
      await runtime.stop();
      console.log(pc.green("✓ CouchDB stopped"));
    } catch (error) {
      console.error(
        pc.red(
          `Failed to stop: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

LocalCommand.command("status")
  .description("Check local CouchDB status")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const runtime = new LocalRuntime();
    const status = await runtime.status();

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (status.running) {
      console.log(pc.green("✓ CouchDB is running"));
      console.log(pc.dim(`  URL:     ${status.url}`));
      console.log(pc.dim(`  PID:     ${status.pid}`));
      console.log(pc.dim(`  Version: ${status.version}`));
      console.log(pc.dim(`  Runtime: ${status.runtime}`));
    } else {
      console.log(pc.yellow("○ CouchDB is not running"));
      console.log(pc.dim("  Run: sillon local up"));
    }
  });
