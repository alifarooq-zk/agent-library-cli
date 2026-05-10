import { Command } from "commander";
import { join, resolve } from "node:path";
import { loadManifest } from "../manifest/load.ts";
import {
  formatIssue,
  validateManifest,
  validateResolvedArtifactsScope,
} from "../manifest/validate.ts";
import { ManifestSchema } from "../manifest/schema.ts";
import { resolveHomeRoot } from "../util/home.ts";
import { resolveIncludes } from "../resolve/sources.ts";

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

    if (issues.length > 0) {
      for (const issue of issues) {
        process.stderr.write(`${formatIssue(issue)}\n`);
      }
      process.exit(1);
    }

    const manifest = ManifestSchema.parse(loaded.value);
    const absProjectRoot = resolve(projectRoot);
    const homeRoot = resolveHomeRoot();
    const resolveCtx =
      manifest.scope === "home"
        ? ({ kind: "home", homeRoot } as const)
        : ({ kind: "project", homeRoot, projectRoot: absProjectRoot } as const);
    const resolveResult = await resolveIncludes(manifest.include, resolveCtx);

    if (!resolveResult.ok) {
      process.stderr.write(`error: ${resolveResult.error.message}\n`);
      process.exit(1);
    }

    const resolvedScopeIssues = validateResolvedArtifactsScope(
      manifest,
      resolveResult.value,
    );

    if (resolvedScopeIssues.length > 0) {
      for (const issue of resolvedScopeIssues) {
        process.stderr.write(`${formatIssue(issue)}\n`);
      }
      process.exit(1);
    }

    process.stdout.write(`✓ ${manifestPath} is valid\n`);
    process.exit(0);
  });
