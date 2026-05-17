import { join } from "node:path";
import type { SyncPlan, PlanFileWrite } from "./plan.ts";
import {
  writeAdapterSource,
  writeArtifactId,
  writeTargetFile,
  writeTargetRelative,
} from "./plan.ts";
import { renderHeader } from "./header.ts";
import { mergeWithAdapter } from "./adapters.ts";
import { writeFileAtomic } from "../util/fs.ts";
import { readLockfile, type LockfileReadError } from "../lockfile/read.ts";
import { writeLockfile, type LockfileWriteError } from "../lockfile/write.ts";
import { cleanupStaleFiles, findStaleGeneratedTargets } from "./cleanup.ts";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
import { buildLockfileFromWrittenContents } from "./lockfile.ts";
import { syncFileError, type SyncFileError } from "./errors.ts";

export interface GeneratedSyncResult {
  written: number;
  removedStale: number;
}

export interface SyncRunOptions {
  dryRun?: boolean;
  lockfilePath?: string;
}

export type GeneratedSyncError =
  | LockfileReadError
  | LockfileWriteError
  | SyncFileError;

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
  const lockfilePath =
    options.lockfilePath ?? join(plan.projectRoot, ".agent-library.lock");

  // 1. Read previous lockfile before writing anything
  const previousLockfileResult = await readLockfile(lockfilePath);
  if (!previousLockfileResult.ok) return previousLockfileResult;
  const previousLockfile = previousLockfileResult.value;
  const newTargetPaths = new Set(plan.writes.map(writeTargetRelative));

  if (options.dryRun) {
    for (const w of plan.writes) {
      process.stdout.write(`[dry-run] would write ${writeTargetRelative(w)}\n`);
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
  const writtenTargets: string[] = [];

  for (const w of plan.writes) {
    const targetRelative = writeTargetRelative(w);
    const contentResult = await buildContent(w, plan);
    if (!contentResult.ok) return contentResult;

    const writeResult = await ResultKit.fromPromise(
      writeFileAtomic(writeTargetFile(w), contentResult.value),
      (cause) =>
        syncFileError({
          type: "sync_file_write_error",
          path: writeTargetFile(w),
          role: "write generated target",
          cause,
          writtenTargets,
        }),
    );
    if (!writeResult.ok) return writeResult;

    writtenContents.set(targetRelative, contentResult.value);
    writtenTargets.push(targetRelative);
  }

  // 3. Build the new lockfile by grouping writes by artifact then source file
  const lockfile = await buildLockfileFromWrittenContents(
    plan,
    writtenContents,
  );
  if (!lockfile.ok) return lockfile;

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
  const writeResult = await writeLockfile(lockfilePath, lockfile.value);
  if (!writeResult.ok) return writeResult;

  return ResultKit.success({ written: plan.writes.length, removedStale });
}

export async function buildContent(
  w: PlanFileWrite,
  plan: SyncPlan,
): Promise<Result<string | Uint8Array, SyncFileError>> {
  if (w.source.contentKind === "markdown") {
    const header = renderHeader({ source: writeArtifactId(w), mode: plan.mode });
    const neutralResult = await ResultKit.fromPromise(
      Bun.file(w.source.filePath).text(),
      (cause) =>
        syncFileError({
          type: "sync_file_read_error",
          path: w.source.filePath,
          role: "read source",
          cause,
        }),
    );
    if (!neutralResult.ok) return neutralResult;

    const adapterSource = writeAdapterSource(w);
    const adapterResult = adapterSource
      ? await ResultKit.fromPromise(Bun.file(adapterSource).text(), (cause) =>
          syncFileError({
            type: "sync_file_read_error",
            path: adapterSource,
            role: "read adapter",
            cause,
          }),
        )
      : ResultKit.success(null);
    if (!adapterResult.ok) return adapterResult;

    return ResultKit.success(
      mergeWithAdapter({
        header,
        neutral: neutralResult.value,
        adapter: adapterResult.value,
        preserveFrontmatter: w.source.preserveFrontmatter,
      }),
    );
  }
  return ResultKit.fromPromise(Bun.file(w.source.filePath).bytes(), (cause) =>
    syncFileError({
      type: "sync_file_read_error",
      path: w.source.filePath,
      role: "read source",
      cause,
    }),
  );
}
