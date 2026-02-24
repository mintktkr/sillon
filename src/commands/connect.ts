import { Command } from "commander";
import pc from "picocolors";
import { ConfigManager } from "../lib/config.js";

export const ConnectCommand = new Command("connect")
  .description("Connect to a CouchDB server")
  .argument("<url>", "CouchDB URL (e.g., http://admin:pass@localhost:5984)")
  .option("-n, --name <name>", "Save as named connection")
  .option("--default", "Set as default connection")
  .action(async (url: string, options) => {
    const config = new ConfigManager();
    
    // Test connection
    console.log(pc.cyan("🔄 Testing connection..."));
    
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const info = await response.json();
      
      console.log(pc.green(`✓ Connected to CouchDB ${info.version}`));
      console.log(pc.dim(`  Vendor: ${info.vendor?.name || "Apache"}`));
      
      // Save connection
      if (options.name) {
        await config.saveConnection(options.name, url);
        console.log(pc.dim(`  Saved as "${options.name}"`));
      }
      
      if (options.default || !options.name) {
        await config.setDefaultConnection(url);
        console.log(pc.dim("  Set as default connection"));
      }
      
    } catch (error) {
      console.error(pc.red(`✗ Connection failed: ${error.message}`));
      process.exit(1);
    }
  });