import { Command } from "commander";
import { join, resolve } from "node:path";
import { loadManifest } from "../manifest/load.ts";
import { validateManifest, validateSkillNames } from "../manifest/validate.ts";
import { ManifestSchema } from "../manifest/schema.ts";
import { resolveIncludes } from "../resolve/sources.ts";
import { resolveHomeRoot } from "../util/home.ts";
import { buildPlan } from "../sync/plan.ts";
import { runGeneratedSync } from "../sync/generated.ts";
import { runVendoredSync } from "../sync/vendored.ts";
import { printSummary, countByKind } from "../sync/summary.ts";
import { detectCollisions } from "../artifact/collision.ts";

export const syncCommand = new Command("sync")
  .description("Sync agent library assets into a project")
  .argument(
    "<project-root>",
    "path to the project root containing .agent-library.yml",
  )
  .option("--home <path>", "override the home library root")
  .option("--dry-run", "print the sync plan without writing files")
  .action(async (projectRoot: string, opts: { home?: string; dryRun?: boolean }) => {
    const absProjectRoot = resolve(projectRoot);
    const manifestPath = join(absProjectRoot, ".agent-library.yml");
    const homeRoot = resolveHomeRoot(opts.home);
    const dryRun = opts.dryRun === true;

    // Load and structurally validate the manifest
    const loaded = await loadManifest(manifestPath);

    if (!loaded.ok) {
      process.stderr.write(`error: cannot read ${manifestPath}\n`);
      process.exit(1);
    }

    const structuralIssues = validateManifest(loaded.value);

    if (structuralIssues.length > 0) {
      for (const issue of structuralIssues) {
        process.stderr.write(`${issue.path}: ${issue.message}\n`);
      }

      process.exit(1);
    }

    // Safe to parse into a typed Manifest now — structural validation already passed
    const manifest = ManifestSchema.parse(loaded.value);
    const ctx = { homeRoot, projectRoot: absProjectRoot };

    // Resolve artifacts once; use the result for all subsequent validation and the plan
    const resolveResult = await resolveIncludes(manifest.include, ctx);

    if (!resolveResult.ok) {
      process.stderr.write(`error: ${resolveResult.error.message}\n`);
      process.exit(1);
    }

    const artifacts = resolveResult.value;

    // SKILL.md name validation (uses already-resolved artifacts — no extra resolve pass)
    const nameIssues = await validateSkillNames(artifacts);

    if (nameIssues.length > 0) {
      for (const issue of nameIssues) {
        process.stderr.write(`${issue.path}: ${issue.message}\n`);
      }

      process.exit(1);
    }

    // Build plan and run sync
    const plan = buildPlan(manifest, artifacts, absProjectRoot);

    // Detect target path collisions before writing anything
    const collisions = detectCollisions(
      plan.writes.map((w) => ({
        artifactId: w.artifactId,
        targetPath: w.targetRelative,
      })),
    );

    if (collisions.length > 0) {
      for (const c of collisions) {
        process.stderr.write(
          `collision: '${c.targetPath}' is claimed by: ${c.sources.join(", ")}\n`,
        );
      }
      process.exit(1);
    }

    const counts = countByKind(plan);

    if (manifest.mode === "vendored") {
      // Vendored mode updates/creates files only; it never removes stale files.
      const syncResult = await runVendoredSync(plan, { dryRun });
      if (!syncResult.ok) {
        process.stderr.write(`error: ${syncResult.error.message}\n`);
        process.exit(1);
      }
      printSummary({
        projectRoot: absProjectRoot,
        mode: manifest.mode,
        target: manifest.target,
        skills: counts.skills,
        commands: counts.commands,
        agents: counts.agents,
        removedStale: 0,
        vendoredSkipped: syncResult.value.skipped.map((s) => ({
          path: s.path,
          reason: s.reason,
        })),
        lockfile: ".agent-library.lock",
        dryRun,
      });
      return;
    }

    const syncResult = await runGeneratedSync(plan, { dryRun });
    if (!syncResult.ok) {
      process.stderr.write(`error: ${syncResult.error.message}\n`);
      process.exit(1);
    }
    printSummary({
      projectRoot: absProjectRoot,
      mode: manifest.mode,
      target: manifest.target,
      skills: counts.skills,
      commands: counts.commands,
      agents: counts.agents,
      removedStale: syncResult.value.removedStale,
      lockfile: ".agent-library.lock",
      dryRun,
    });
  });
