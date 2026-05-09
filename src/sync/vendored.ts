import { join } from "node:path";
import type { Lockfile } from "../lockfile/schema.ts";
import { hashFile } from "../lockfile/hash.ts";
import { readLockfile, type LockfileReadError } from "../lockfile/read.ts";
import { writeLockfile, type LockfileWriteError } from "../lockfile/write.ts";
import { writeFileAtomic } from "../util/fs.ts";
import type { SyncPlan } from "./plan.ts";
import {
  writeArtifactId,
  writeTargetFile,
  writeTargetRelative,
} from "./plan.ts";
import { buildContent, type SyncRunOptions } from "./generated.ts";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
import { syncFileError, type SyncFileError } from "./errors.ts";
import {
  buildLockfileFromTargetEntries,
  existingTargetLockEntry,
  writtenTargetLockEntry,
  type LockfileTargetAdapter,
  type TargetLockEntry,
} from "./lockfile.ts";

export interface VendoredSkippedFile {
  path: string;
  sourceArtifact: string;
  reason:
    | "locally edited"
    | "pre-existing file, no lockfile to verify ownership";
}

export interface VendoredSyncResult {
  written: number;
  skipped: VendoredSkippedFile[];
}

export type VendoredSyncError =
  | LockfileReadError
  | LockfileWriteError
  | SyncFileError;

interface PreviousTargetEntry {
  targetHash: string;
  adapter: LockfileTargetAdapter;
}

export async function runVendoredSync(
  plan: SyncPlan,
  options: SyncRunOptions = {},
): Promise<Result<VendoredSyncResult, VendoredSyncError>> {
  if (options.dryRun) {
    for (const w of plan.writes) {
      process.stdout.write(`[dry-run] would write ${writeTargetRelative(w)}\n`);
    }
    return ResultKit.success({ written: 0, skipped: [] });
  }

  const lockfilePath = join(plan.projectRoot, ".agent-library.lock");
  const previousLockfileResult = await readLockfile(lockfilePath);
  if (!previousLockfileResult.ok) return previousLockfileResult;
  const previousLockfile = previousLockfileResult.value;
  const previousTargets = indexPreviousTargets(previousLockfile);
  const writtenContents = new Map<string, string | Uint8Array>();
  const targetEntries: TargetLockEntry[] = [];
  const skipped: VendoredSkippedFile[] = [];

  for (const w of plan.writes) {
    const targetRelative = writeTargetRelative(w);
    const previous = previousTargets.get(targetRelative) ?? null;
    const targetExistsResult = await ResultKit.fromPromise(
      Bun.file(writeTargetFile(w)).exists(),
      (cause) =>
        syncFileError({
          type: "sync_file_stat_error",
          path: writeTargetFile(w),
          role: "stat vendored target",
          cause,
        }),
    );
    if (!targetExistsResult.ok) return targetExistsResult;

    if (!targetExistsResult.value) {
      const contentResult = await buildContent(w, plan);
      if (!contentResult.ok) return contentResult;

      const writeResult = await ResultKit.fromPromise(
        writeFileAtomic(writeTargetFile(w), contentResult.value),
        (cause) =>
          syncFileError({
            type: "sync_file_write_error",
            path: writeTargetFile(w),
            role: "write vendored target",
            cause,
          }),
      );
      if (!writeResult.ok) return writeResult;

      writtenContents.set(targetRelative, contentResult.value);
      const entryResult = await writtenTargetLockEntry(w, contentResult.value);
      if (!entryResult.ok) return entryResult;
      targetEntries.push(entryResult.value);
      continue;
    }

    if (!previous) {
      skipped.push({
        path: targetRelative,
        sourceArtifact: writeArtifactId(w),
        reason: "pre-existing file, no lockfile to verify ownership",
      });
      continue;
    }

    const currentTargetHashResult = await ResultKit.fromPromise(
      hashFile(writeTargetFile(w)),
      (cause) =>
        syncFileError({
          type: "sync_file_read_error",
          path: writeTargetFile(w),
          role: "hash vendored target",
          cause,
        }),
    );
    if (!currentTargetHashResult.ok) return currentTargetHashResult;

    const currentTargetHash = currentTargetHashResult.value;
    if (currentTargetHash === previous.targetHash) {
      const contentResult = await buildContent(w, plan);
      if (!contentResult.ok) return contentResult;

      const writeResult = await ResultKit.fromPromise(
        writeFileAtomic(writeTargetFile(w), contentResult.value),
        (cause) =>
          syncFileError({
            type: "sync_file_write_error",
            path: writeTargetFile(w),
            role: "write vendored target",
            cause,
          }),
      );
      if (!writeResult.ok) return writeResult;

      writtenContents.set(targetRelative, contentResult.value);
      const entryResult = await writtenTargetLockEntry(w, contentResult.value);
      if (!entryResult.ok) return entryResult;
      targetEntries.push(entryResult.value);
      continue;
    }

    skipped.push({
      path: targetRelative,
      sourceArtifact: writeArtifactId(w),
      reason: "locally edited",
    });
    targetEntries.push(
      existingTargetLockEntry(w, previous.targetHash, previous.adapter),
    );
  }

  const lockfile = await buildLockfileFromTargetEntries(plan, targetEntries);
  if (!lockfile.ok) return lockfile;

  const writeResult = await writeLockfile(lockfilePath, lockfile.value);
  if (!writeResult.ok) return writeResult;

  for (const s of skipped) {
    process.stderr.write(
      `warning: vendored file skipped: ${s.path} (${s.reason}; source: ${s.sourceArtifact})\n`,
    );
  }

  return ResultKit.success({ written: writtenContents.size, skipped });
}

function indexPreviousTargets(
  previous: Lockfile | null,
): Map<string, PreviousTargetEntry> {
  const targets = new Map<string, PreviousTargetEntry>();
  if (!previous) return targets;

  for (const artifact of previous.artifacts) {
    for (const file of artifact.files) {
      for (const target of file.targets) {
        targets.set(target.path, {
          targetHash: target.targetHash,
          adapter: target.adapter,
        });
      }
    }
  }

  return targets;
}
