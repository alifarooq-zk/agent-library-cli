import { Command } from "commander";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadManifest } from "../manifest/load.ts";
import {
  formatIssue,
  validateManifest,
  validateResolvedArtifactsScope,
  validateSkillSpecs,
} from "../manifest/validate.ts";
import { ManifestSchema } from "../manifest/schema.ts";
import { resolveIncludes } from "../resolve/sources.ts";
import { resolveSource } from "../resolve/source.ts";
import { resolveHomePaths, resolveHomeRoot } from "../util/home.ts";
import { readLockfile } from "../lockfile/read.ts";
import {
  buildPlan,
  writeArtifactId,
  writeTargetRelative,
  type SyncPlanSource,
} from "../sync/plan.ts";
import { runGeneratedSync } from "../sync/generated.ts";
import { runVendoredSync } from "../sync/vendored.ts";
import { printSummary, countByKind } from "../sync/summary.ts";
import { detectCollisions } from "../artifact/collision.ts";
import { upsertProjectEntry } from "../cache/registry.ts";

interface SyncOptions {
  home?: string;
  global?: boolean;
  dryRun?: boolean;
  update?: boolean;
}

export const syncCommand = new Command("sync")
  .description("Sync agent library assets into a project")
  .argument(
    "[project-root]",
    "path to the project root containing .agent-library.yml",
  )
  .option(
    "--home <path>",
    "override the home library root (bypasses source resolution)",
  )
  .option("--global", "sync the home-scoped manifest from the home base")
  .option("--dry-run", "print the sync plan without writing files")
  .option(
    "--update",
    "fetch latest remote state and update pinned SHA in lockfile",
  )
  .action(
    async (
      projectRoot: string | undefined,
      opts: SyncOptions,
    ) => {
      const isGlobal = opts.global === true;
      if (!isGlobal && !projectRoot) {
        process.stderr.write("error: missing required argument 'project-root'\n");
        process.exit(1);
      }

      const homePaths = isGlobal
        ? resolveHomePaths(process.platform, process.env, opts.home)
        : null;
      const absProjectRoot =
        isGlobal && homePaths
          ? dirname(homePaths.manifest)
          : resolve(projectRoot!);
      const manifestPath =
        isGlobal && homePaths
          ? homePaths.manifest
          : join(absProjectRoot, ".agent-library.yml");
      const lockfilePath =
        isGlobal && homePaths
          ? homePaths.lockfile
          : join(absProjectRoot, ".agent-library.lock");
      const dryRun = opts.dryRun === true;
      const update = opts.update === true;
      const libraryTreeOverride = !isGlobal
        ? opts.home ?? process.env.HOME_AGENT_LIBRARY
        : undefined;
      const summaryLockfile = isGlobal ? lockfilePath : ".agent-library.lock";

      if (isGlobal && !existsSync(manifestPath)) {
        process.stderr.write(
          `error: no home manifest found at ${manifestPath}; run \`agent-lib init --global\` to create one\n`,
        );
        process.exit(1);
      }

      // Load and structurally validate the manifest
      const loaded = await loadManifest(manifestPath);

      if (!loaded.ok) {
        process.stderr.write(`error: cannot read ${manifestPath}\n`);
        process.exit(1);
      }

      const schemaResult = ManifestSchema.safeParse(loaded.value);
      const structuralIssues = isGlobal
        ? schemaResult.success
          ? []
          : schemaResult.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            }))
        : validateManifest(loaded.value);

      if (structuralIssues.length > 0) {
        for (const issue of structuralIssues) {
          process.stderr.write(`${formatIssue(issue)}\n`);
        }

        process.exit(1);
      }

      // Safe to cast — structural validation above already exited on any schema error
      const manifest = schemaResult.data!;

      if (isGlobal && manifest.scope !== "home") {
        process.stderr.write(
          `error: home manifest at ${manifestPath} must set scope: home\n`,
        );
        process.exit(1);
      }
      let homeRoot: string;
      let syncPlanSource: SyncPlanSource | undefined;

      if (libraryTreeOverride) {
        homeRoot = resolveHomeRoot(libraryTreeOverride);
        const previousLockfileResult = await readLockfile(lockfilePath);
        if (!previousLockfileResult.ok) {
          process.stderr.write(
            `error: ${previousLockfileResult.error.message}\n`,
          );
          process.exit(1);
        }
        syncPlanSource = previousLockfileResult.value?.source;
      } else {
        const manifestSource = manifest.source;
        if (!manifestSource) {
          process.stderr.write(
            "source: source is required; add a source block with type, repo, and ref\n",
          );
          process.exit(1);
        }

        const sourceResult = await resolveSource(manifestSource, lockfilePath, {
          update,
        });
        if (!sourceResult.ok) {
          process.stderr.write(`error: ${sourceResult.error.message}\n`);
          process.exit(1);
        }
        homeRoot = sourceResult.value.homeRoot;
        syncPlanSource = sourceResult.value.source;
      }

      const ctx = {
        kind: "project" as const,
        homeRoot,
        projectRoot: absProjectRoot,
      };

      // Resolve artifacts once; use the result for all subsequent validation and the plan
      const resolveResult = await resolveIncludes(manifest.include, ctx);

      if (!resolveResult.ok) {
        process.stderr.write(`error: ${resolveResult.error.message}\n`);
        process.exit(1);
      }

      const artifacts = resolveResult.value;

      const resolvedScopeIssues = validateResolvedArtifactsScope(
        manifest,
        artifacts,
      );

      if (resolvedScopeIssues.length > 0) {
        for (const issue of resolvedScopeIssues) {
          process.stderr.write(`${formatIssue(issue)}\n`);
        }

        process.exit(1);
      }

      // SKILL.md name validation (uses already-resolved artifacts — no extra resolve pass)
      const nameIssues = await validateSkillSpecs(artifacts);

      if (nameIssues.length > 0) {
        for (const issue of nameIssues) {
          process.stderr.write(`${issue.path}: ${issue.message}\n`);
        }

        process.exit(1);
      }

      // Build plan and run sync
      const plan = buildPlan(
        manifest,
        artifacts,
        absProjectRoot,
        syncPlanSource,
      );

      // Detect target path collisions before writing anything
      const collisions = detectCollisions(
        plan.writes.map((w) => ({
          artifactId: writeArtifactId(w),
          targetPath: writeTargetRelative(w),
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
        const syncResult = await runVendoredSync(plan, {
          dryRun,
          lockfilePath,
        });
        if (!syncResult.ok) {
          process.stderr.write(`error: ${syncResult.error.message}\n`);
          process.exit(1);
        }
        if (
          !dryRun &&
          syncPlanSource &&
          !libraryTreeOverride &&
          !(await recordProjectSource(absProjectRoot, syncPlanSource))
        ) {
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
          lockfile: summaryLockfile,
          dryRun,
        });
        return;
      }

      const syncResult = await runGeneratedSync(plan, {
        dryRun,
        lockfilePath,
      });
      if (!syncResult.ok) {
        process.stderr.write(`error: ${syncResult.error.message}\n`);
        process.exit(1);
      }
      if (
        !dryRun &&
        syncPlanSource &&
        !libraryTreeOverride &&
        !(await recordProjectSource(absProjectRoot, syncPlanSource))
      ) {
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
        lockfile: summaryLockfile,
        dryRun,
      });
    },
  );

async function recordProjectSource(
  projectRoot: string,
  source: SyncPlanSource,
): Promise<boolean> {
  const registryResult = await upsertProjectEntry(undefined, {
    path: projectRoot,
    repo: source.repo,
    ref: source.ref,
    sha: source.sha,
    lastSyncedAt: new Date().toISOString(),
  });

  if (!registryResult.ok) {
    process.stderr.write(`error: ${registryResult.error.message}\n`);
    return false;
  }

  return true;
}
