import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { validateCommand } from "./commands/validate.ts";
import { listCommand } from "./commands/list.ts";
import { syncCommand } from "./commands/sync.ts";
import { initCommand } from "./commands/init.ts";

const program = new Command()
  .name("agent-library")
  .description("Agent library sync tool")
  .version(pkg.version);

program.addCommand(validateCommand);
program.addCommand(listCommand);
program.addCommand(syncCommand);
program.addCommand(initCommand);

program.parse();
