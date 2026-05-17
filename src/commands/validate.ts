import { Command } from "commander";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadManifest } from "../manifest/load.ts";
import {
  formatIssue,
  validateManifest,
  validateResolvedArtifactsScope,
} from "../manifest/validate.ts";
import { ManifestSchema } from "../manifest/schema.ts";
import { resolveIncludes } from "../resolve/sources.ts";
import { resolveSource } from "../resolve/source.ts";
import { readLockfile } from "../lockfile/read.ts";

interface ValidateOptions {
  resolve?: boolean;
}

export const validateCommand = new Command("validate")
  .description("Validate a .agent-library.yml manifest")
  .argument(
    "<project-root>",
    "path to the project root containing .agent-library.yml",
  )
  .option(
    "--no-resolve",
    "skip include-resolution validation and validate manifest structure only",
  )
  .action(async (projectRoot: string, opts: ValidateOptions) => {
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

    if (opts.resolve === false) {
      process.stdout.write(`ok: ${manifestPath} is valid\n`);
      process.exit(0);
    }

    if (!manifest.source) {
      process.stderr.write(
        "source: source is required; add a source block with type, repo, and ref\n",
      );
      process.exit(1);
    }

    const lockfilePath = join(absProjectRoot, ".agent-library.lock");
    if (!existsSync(lockfilePath)) {
      process.stderr.write(
        "error: no lockfile found; run `agent-library sync` first, or pass `--no-resolve` to skip include-resolution validation\n",
      );
      process.exit(1);
    }

    const lockResult = await readLockfile(lockfilePath);
    if (!lockResult.ok) {
      process.stderr.write(`error: ${lockResult.error.message}\n`);
      process.exit(1);
    }
    if (!lockResult.value?.source?.sha) {
      process.stderr.write(
        "error: lockfile has no pinned source SHA; run `agent-library sync` (without --home) to resolve from GitHub, or pass `--no-resolve` to skip include-resolution validation\n",
      );
      process.exit(1);
    }

    const sourceResult = await resolveSource(manifest.source, lockfilePath, {
      update: false,
    });
    if (!sourceResult.ok) {
      if (sourceResult.error.type === "git_sha_not_cached") {
        process.stderr.write(
          "error: locked SHA not in cache; run `sync --update`\n",
        );
      } else {
        process.stderr.write(`error: ${sourceResult.error.message}\n`);
      }
      process.exit(1);
    }

    const homeRoot = sourceResult.value.homeRoot;
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

    process.stdout.write(`ok: ${manifestPath} is valid\n`);
    process.exit(0);
  });
