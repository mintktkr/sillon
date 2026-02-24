import { Command } from "commander";
import pc from "picocolors";

export const DocCommand = new Command("doc")
  .description("Document operations");

DocCommand
  .command("list <db>")
  .description("List documents in a database")
  .action(async (db: string) => {
    console.log(pc.yellow(`Listing documents in ${db} - not yet implemented`));
  });

DocCommand
  .command("get <db> <id>")
  .description("Get a document")
  .action(async (db: string, id: string) => {
    console.log(pc.yellow(`Getting ${id} from ${db} - not yet implemented`));
  });

DocCommand
  .command("put <db> [id] [json]")
  .description("Insert or update a document")
  .action(async (db: string, id?: string, json?: string) => {
    console.log(pc.yellow(`Putting document to ${db} - not yet implemented`));
  });

DocCommand
  .command("edit <db> <id>")
  .description("Edit a document in $EDITOR")
  .action(async (db: string, id: string) => {
    console.log(pc.yellow(`Editing ${id} in ${db} - not yet implemented`));
  });

DocCommand
  .command("delete <db> <id>")
  .description("Delete a document")
  .action(async (db: string, id: string) => {
    console.log(pc.yellow(`Deleting ${id} from ${db} - not yet implemented`));
  });
