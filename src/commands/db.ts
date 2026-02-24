import { Command } from "commander";
import pc from "picocolors";
import { CouchClient } from "../lib/couch-client.js";
import { ConfigManager } from "../lib/config.js";

export const DbCommand = new Command("db")
  .description("Database operations");

DbCommand
  .command("list")
  .description("List all databases")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const config = await new ConfigManager().getActiveConnection();
    const client = new CouchClient(config.url);
    
    try {
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
      console.error(pc.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

DbCommand
  .command("create <name>")
  .description("Create a new database")
  .option("--partitioned", "Create as partitioned database")
  .action(async (name: string, options) => {
    const config = await new ConfigManager().getActiveConnection();
    const client = new CouchClient(config.url);
    
    try {
      await client.createDatabase(name, { partitioned: options.partitioned });
      console.log(pc.green(`✓ Created database "${name}"`));
      
      if (options.partitioned) {
        console.log(pc.dim("  (partitioned)"));
      }
    } catch (error) {
      console.error(pc.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

DbCommand
  .command("delete <name>")
  .description("Delete a database")
  .option("-f, --force", "Skip confirmation")
  .action(async (name: string, options) => {
    if (!options.force) {
      console.log(pc.yellow(`⚠️  This will permanently delete "${name}"`));
      // In a full implementation, we'd prompt for confirmation here
      console.log(pc.dim("Use --force to skip this warning"));
      return;
    }
    
    const config = await new ConfigManager().getActiveConnection();
    const client = new CouchClient(config.url);
    
    try {
      await client.deleteDatabase(name);
      console.log(pc.green(`✓ Deleted database "${name}"`));
    } catch (error) {
      console.error(pc.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

DbCommand
  .command("info [name]")
  .description("Show database information")
  .option("--json", "Output as JSON")
  .action(async (name?: string, options?) => {
    const config = await new ConfigManager().getActiveConnection();
    const client = new CouchClient(config.url);
    
    // If no name provided, we could use fuzzy finder here
    if (!name) {
      console.log(pc.yellow("Usage: sillon db info <name>"));
      return;
    }
    
    try {
      const info = await client.getDatabaseInfo(name);
      
      if (options?.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }
      
      console.log(pc.cyan(`📊 Database: ${name}`));
      console.log(`  ${pc.dim("Documents:")} ${info.doc_count}`);
      console.log(`  ${pc.dim("Deleted:")} ${info.doc_del_count}`);
      console.log(`  ${pc.dim("Size:")} ${formatBytes(info.sizes?.active || 0)}`);
      console.log(`  ${pc.dim("Update sequence:")} ${info.update_seq}`);
      
      if (info.props?.partitioned) {
        console.log(`  ${pc.dim("Type:")} partitioned`);
      }
      
    } catch (error) {
      console.error(pc.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}