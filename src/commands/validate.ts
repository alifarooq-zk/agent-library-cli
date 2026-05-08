import { Command } from "commander";
import { join } from "node:path";
import { loadManifest } from "../manifest/load.ts";
import { validateManifest } from "../manifest/validate.ts";

export const validateCommand = new Command("validate")
  .description("Validate a .agent-library.yml manifest")
  .argument(
    "<project-root>",
    "path to the project root containing .agent-library.yml",
  )
  .action(async (projectRoot: string) => {
    const manifestPath = join(projectRoot, ".agent-library.yml");

    const loaded = await loadManifest(manifestPath);
    if (!loaded.ok) {
      process.stderr.write(`error: cannot read ${manifestPath}\n`);
      process.exit(1);
    }

    const issues = validateManifest(loaded.value);

    if (issues.length === 0) {
      process.stdout.write(`✓ ${manifestPath} is valid\n`);
      process.exit(0);
    }

    for (const issue of issues) {
      process.stderr.write(`${issue.path}: ${issue.message}\n`);
    }

    process.exit(1);
  });
