import { Command } from "commander";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readRegistry } from "../cache/registry.ts";
import { readLockfile } from "../lockfile/read.ts";
import { defaultCacheRoot } from "../util/cache.ts";

export const cacheCommand = new Command("cache").description(
  "Manage the agent-library cache",
);

cacheCommand
  .command("prune")
  .description("Remove extracted trees not referenced by any active lockfile")
  .action(async () => {
    const cacheRoot = defaultCacheRoot();
    const registryPath = join(cacheRoot, "projects.json");
    const treesDir = join(cacheRoot, "trees");

    const registryResult = await readRegistry(registryPath);
    if (!registryResult.ok) {
      process.stderr.write(`error: ${registryResult.error.message}\n`);
      process.exit(1);
    }

    const activeShas = new Set<string>();
    for (const project of registryResult.value.projects) {
      const lockfilePath = join(project.path, ".agent-library.lock");
      if (!existsSync(lockfilePath)) continue;

      const lockResult = await readLockfile(lockfilePath);
      if (!lockResult.ok) {
        process.stderr.write(
          `warning: skipping ${project.path}: ${lockResult.error.message}\n`,
        );
        continue;
      }
      if (lockResult.value?.source) {
        activeShas.add(lockResult.value.source.sha);
      }
    }

    if (!existsSync(treesDir)) {
      process.stdout.write("cache prune: no trees directory found\n");
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(treesDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `error: cannot read trees directory ${treesDir}: ${msg}\n`,
      );
      process.exit(1);
    }

    let pruned = 0;
    let failed = 0;
    for (const entry of entries) {
      if (activeShas.has(entry)) continue;

      try {
        rmSync(join(treesDir, entry), { recursive: true, force: true });
        pruned++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`warning: failed to remove ${entry}: ${msg}\n`);
        failed++;
      }
    }

    if (failed > 0) {
      process.stderr.write(
        `cache prune: removed ${pruned} unreferenced tree(s), ${failed} could not be removed\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `cache prune: removed ${pruned} unreferenced tree(s)\n`,
    );
  });
