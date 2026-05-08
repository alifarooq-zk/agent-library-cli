import { relative, join } from "node:path";
import type { SyncPlan, PlanFileWrite } from "./plan.ts";
import { renderHeader } from "./header.ts";
import { mergeWithAdapter } from "./adapters.ts";
import { writeFileAtomic } from "../util/fs.ts";
import { readLockfile, type LockfileReadError } from "../lockfile/read.ts";
import { writeLockfile, type LockfileWriteError } from "../lockfile/write.ts";
import { hashBytes, hashFile } from "../lockfile/hash.ts";
import { cleanupStaleFiles, findStaleGeneratedTargets } from "./cleanup.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
// @ts-ignore — resolveJsonModule + allowImportingTsExtensions handles this
import pkg from "../../package.json";

export interface GeneratedSyncResult {
  written: number;
  removedStale: number;
}

export interface SyncRunOptions {
  dryRun?: boolean;
}

export type GeneratedSyncError = LockfileReadError | LockfileWriteError;

/**
 * Execute a generated-mode sync plan.
 * Reads the previous lockfile before writing, writes all target files,
 * hashes sources and targets for the new lockfile, runs stale-file cleanup,
 * then writes the new lockfile.
 */
export async function runGeneratedSync(
  plan: SyncPlan,
  options: SyncRunOptions = {},
): Promise<Result<GeneratedSyncResult, GeneratedSyncError>> {
  const lockfilePath = join(plan.projectRoot, ".agent-library.lock");

  // 1. Read previous lockfile before writing anything
  const previousLockfileResult = await readLockfile(lockfilePath);
  if (!previousLockfileResult.ok) return previousLockfileResult;
  const previousLockfile = previousLockfileResult.value;
  const newTargetPaths = new Set(plan.writes.map((w) => w.targetRelative));

  if (options.dryRun) {
    for (const w of plan.writes) {
      process.stdout.write(`[dry-run] would write ${w.targetRelative}\n`);
    }

    if (previousLockfile) {
      const stale = await findStaleGeneratedTargets(
        plan.projectRoot,
        previousLockfile,
        newTargetPaths,
      );
      for (const target of stale.removable) {
        process.stdout.write(`[dry-run] would remove ${target.path}\n`);
      }
      for (const s of stale.skipped) {
        process.stderr.write(
          `warning: skipped stale file (no generated ownership header): ${s.path}\n`,
        );
      }
    }

    return ResultKit.success({ written: 0, removedStale: 0 });
  }

  // 2. Write all files, collect content for hashing
  const writtenContents = new Map<string, string | Uint8Array>(); // targetRelative -> content

  for (const w of plan.writes) {
    const content = await buildContent(w, plan);
    await writeFileAtomic(w.targetFile, content);
    writtenContents.set(w.targetRelative, content);
  }

  // 3. Build the new lockfile by grouping writes by artifact then source file
  const lockfile = await buildLockfile(plan, writtenContents);

  // 4. Run stale-file cleanup against previous lockfile
  let removedStale = 0;
  if (previousLockfile) {
    const result = await cleanupStaleFiles(
      plan.projectRoot,
      previousLockfile,
      newTargetPaths,
    );
    removedStale = result.removed;
    for (const s of result.skipped) {
      process.stderr.write(
        `warning: skipped stale file (no generated ownership header): ${s.path}\n`,
      );
    }
  }

  // 5. Write new lockfile
  const writeResult = await writeLockfile(lockfilePath, lockfile);
  if (!writeResult.ok) return writeResult;

  return ResultKit.success({ written: plan.writes.length, removedStale });
}

export async function buildContent(
  w: PlanFileWrite,
  plan: SyncPlan,
): Promise<string | Uint8Array> {
  if (w.isMarkdown) {
    const header = renderHeader({ source: w.artifactId, mode: plan.mode });
    const neutral = await Bun.file(w.sourceFile).text();
    const adapter = w.adapterSource
      ? await Bun.file(w.adapterSource).text()
      : null;
    return mergeWithAdapter({ header, neutral, adapter });
  }
  return Bun.file(w.sourceFile).bytes();
}

async function buildLockfile(
  plan: SyncPlan,
  writtenContents: Map<string, string | Uint8Array>,
): Promise<Lockfile> {
  // Group writes: artifactId -> sourceFile -> PlanFileWrite[]
  const byArtifact = new Map<string, Map<string, PlanFileWrite[]>>();

  for (const w of plan.writes) {
    if (!byArtifact.has(w.artifactId)) {
      byArtifact.set(w.artifactId, new Map());
    }
    const bySource = byArtifact.get(w.artifactId)!;
    if (!bySource.has(w.sourceFile)) {
      bySource.set(w.sourceFile, []);
    }
    bySource.get(w.sourceFile)!.push(w);
  }

  const artifacts: Lockfile["artifacts"] = [];

  for (const [artifactId, bySource] of byArtifact) {
    const firstWrite = bySource.values().next().value![0] as PlanFileWrite;
    const files: Lockfile["artifacts"][number]["files"] = [];

    for (const [sourceFile, writes] of bySource) {
      const sourceBytes = await Bun.file(sourceFile).bytes();
      const sourceHash = hashBytes(sourceBytes);
      const relSource = relative(firstWrite.libraryRoot, sourceFile);

      const targets: Lockfile["artifacts"][number]["files"][number]["targets"] =
        [];

      for (const w of writes) {
        const content = writtenContents.get(w.targetRelative);
        const targetHash = content
          ? hashBytes(
              typeof content === "string"
                ? Buffer.from(content, "utf8")
                : content,
            )
          : await hashFile(w.targetFile);

        let adapterHash: string | null = null;
        if (w.adapterSource) {
          const adapterBytes = await Bun.file(w.adapterSource).bytes();
          adapterHash = hashBytes(adapterBytes);
        }

        targets.push({
          path: w.targetRelative,
          targetHash,
          adapterSource: w.adapterSource
            ? relative(firstWrite.libraryRoot, w.adapterSource)
            : null,
          adapterHash,
        });
      }

      files.push({ source: relSource, sourceHash, targets });
    }

    artifacts.push({
      id: artifactId,
      kind: firstWrite.artifactKind,
      files,
    });
  }

  return {
    version: 1,
    cliVersion: (pkg as { version: string }).version,
    mode: plan.mode,
    target: plan.target,
    syncedAt: new Date().toISOString(),
    include: plan.include,
    artifacts,
  };
}
