import { Command } from "commander";
import pc from "picocolors";
import { ConfigManager } from "../lib/config.js";

export const ConnectCommand = new Command("connect")
  .description("Manage CouchDB connections")
  .action(async () => {
    // No subcommand: show the current active connection
    const config = new ConfigManager();
    try {
      const conn = await config.getActiveConnection();
      const label = conn.name ? pc.cyan(conn.name) : pc.dim("(unnamed)");
      console.log(`${pc.green("●")} Active connection: ${label}`);
      console.log(pc.dim(`  ${conn.url}`));
    } catch (error) {
      console.log(pc.yellow("○ No active connection"));
      console.log(pc.dim("  Run: sillon connect add <url>"));
      console.log(pc.dim("  Or set COUCHDB_URL env var"));
    }
  });

ConnectCommand.command("add <url>")
  .description("Test and save a CouchDB connection")
  .option("-n, --name <name>", "Save as named connection")
  .option("--default", "Set as default connection")
  .action(async (url: string, options) => {
    const config = new ConfigManager();

    console.log(pc.cyan("🔄 Testing connection..."));

    try {
      const normalizedUrl = url.replace(/\/$/, "");
      const response = await fetch(`${normalizedUrl}/`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const info = (await response.json()) as {
        version: string;
        vendor?: { name: string };
      };

      console.log(pc.green(`✓ Connected to CouchDB ${info.version}`));
      console.log(pc.dim(`  Vendor: ${info.vendor?.name ?? "Apache"}`));

      // Save named connection
      if (options.name) {
        await config.saveConnection(options.name, normalizedUrl);
        console.log(pc.dim(`  Saved as "${options.name}"`));
      }

      // Set default: explicitly requested, OR no name given (raw URL default)
      if (options.default) {
        if (options.name) {
          await config.setDefaultByName(options.name);
        } else {
          await config.setDefaultConnection(normalizedUrl);
        }
        console.log(pc.dim("  Set as default connection"));
      } else if (!options.name) {
        // No name and no --default flag: still save as raw default for convenience
        await config.setDefaultConnection(normalizedUrl);
        console.log(pc.dim("  Set as default connection"));
      }
    } catch (error) {
      console.error(
        pc.red(
          `✗ Connection failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

ConnectCommand.command("list")
  .description("List saved connections")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const config = new ConfigManager();

    try {
      const connections = await config.listConnections();

      if (options.json) {
        console.log(JSON.stringify(connections, null, 2));
        return;
      }

      if (connections.length === 0) {
        console.log(pc.yellow("No saved connections"));
        console.log(pc.dim("  Run: sillon connect add <url> -n <name>"));
        return;
      }

      console.log(pc.cyan("🔗 Saved connections:"));
      for (const conn of connections) {
        const marker = conn.isDefault ? pc.green("●") : pc.dim("○");
        const defaultTag = conn.isDefault ? pc.dim(" (default)") : "";
        console.log(`  ${marker} ${pc.bold(conn.name!)}${defaultTag}`);
        console.log(pc.dim(`      ${conn.url}`));
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

ConnectCommand.command("use <name>")
  .description("Set a saved connection as the default")
  .action(async (name: string) => {
    const config = new ConfigManager();

    try {
      await config.setDefaultByName(name);
      const conn = await config.getConnection(name);
      console.log(pc.green(`✓ Default connection set to "${name}"`));
      console.log(pc.dim(`  ${conn?.url}`));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

ConnectCommand.command("remove <name>")
  .alias("rm")
  .description("Remove a saved connection")
  .action(async (name: string) => {
    const config = new ConfigManager();

    try {
      await config.removeConnection(name);
      console.log(pc.green(`✓ Removed connection "${name}"`));
    } catch (error) {
      console.error(
        pc.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });
