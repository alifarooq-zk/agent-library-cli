import { relative } from "node:path";
import { hashBytes } from "../lockfile/hash.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import type { PlanFileWrite, SyncPlan } from "./plan.ts";
import {
  writeAdapterSource,
  writeArtifactId,
  writeArtifactKind,
  writeLibraryRoot,
  writeSourceFile,
  writeTargetRelative,
} from "./plan.ts";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
import { syncFileError, type SyncFileError } from "./errors.ts";
// @ts-ignore — resolveJsonModule + allowImportingTsExtensions handles this
import pkg from "../../package.json";

export type LockfileTargetAdapter =
  Lockfile["artifacts"][number]["files"][number]["targets"][number]["adapter"];

export interface TargetLockEntry {
  readonly write: PlanFileWrite;
  readonly targetHash: string;
  readonly adapter: LockfileTargetAdapter;
}

export async function writtenTargetLockEntry(
  write: PlanFileWrite,
  content: string | Uint8Array,
): Promise<Result<TargetLockEntry, SyncFileError>> {
  const adapterResult = await adapterLockEntry(write);
  if (!adapterResult.ok) return adapterResult;

  return ResultKit.success({
    write,
    targetHash: hashBytes(
      typeof content === "string" ? Buffer.from(content, "utf8") : content,
    ),
    adapter: adapterResult.value,
  });
}

export function existingTargetLockEntry(
  write: PlanFileWrite,
  targetHash: string,
  adapter: LockfileTargetAdapter,
): TargetLockEntry {
  return { write, targetHash, adapter };
}

export async function buildLockfileFromTargetEntries(
  plan: SyncPlan,
  targetEntries: readonly TargetLockEntry[],
): Promise<Result<Lockfile, SyncFileError>> {
  const byArtifact = new Map<string, Map<string, TargetLockEntry[]>>();

  for (const entry of targetEntries) {
    const artifactId = writeArtifactId(entry.write);
    const sourceFile = writeSourceFile(entry.write);
    const artifactEntries = byArtifact.get(artifactId) ?? new Map();
    const fileEntries = artifactEntries.get(sourceFile) ?? [];
    fileEntries.push(entry);
    artifactEntries.set(sourceFile, fileEntries);
    byArtifact.set(artifactId, artifactEntries);
  }

  const artifacts: Lockfile["artifacts"] = [];

  for (const [artifactId, bySource] of byArtifact) {
    const firstEntry = targetEntries.find(
      (e) => writeArtifactId(e.write) === artifactId,
    );
    if (!firstEntry) {
      return ResultKit.failure(
        syncFileError({
          type: "sync_file_read_error",
          path: artifactId,
          role: "resolve artifact representative entry",
          cause: new Error(
            `invariant: no entries found for artifact ${artifactId}`,
          ),
        }),
      );
    }
    const files: Lockfile["artifacts"][number]["files"] = [];

    for (const [sourceFile, entries] of bySource) {
      const sourceBytesResult = await ResultKit.fromPromise(
        Bun.file(sourceFile).bytes(),
        (cause) =>
          syncFileError({
            type: "sync_file_read_error",
            path: sourceFile,
            role: "read lockfile source",
            cause,
          }),
      );
      if (!sourceBytesResult.ok) return sourceBytesResult;

      const sourceHash = hashBytes(sourceBytesResult.value);
      const relSource = relative(
        writeLibraryRoot(firstEntry.write),
        sourceFile,
      );

      files.push({
        source: relSource,
        sourceHash,
        targets: entries.map((entry) => ({
          path: writeTargetRelative(entry.write),
          targetHash: entry.targetHash,
          adapter: entry.adapter,
        })),
      });
    }

    artifacts.push({
      id: artifactId,
      kind: writeArtifactKind(firstEntry.write),
      files,
    });
  }

  return ResultKit.success({
    version: 1 as const,
    cliVersion: (pkg as { version: string }).version,
    mode: plan.mode,
    target: plan.target,
    syncedAt: new Date().toISOString(),
    source: plan.source,
    include: [...plan.include],
    artifacts,
  });
}

export async function buildLockfileFromWrittenContents(
  plan: SyncPlan,
  writtenContents: ReadonlyMap<string, string | Uint8Array>,
): Promise<Result<Lockfile, SyncFileError>> {
  const targetEntries: TargetLockEntry[] = [];

  for (const write of plan.writes) {
    const targetRelative = writeTargetRelative(write);
    const content = writtenContents.get(targetRelative);
    if (content === undefined) {
      return ResultKit.failure(
        syncFileError({
          type: "sync_file_read_error",
          path: targetRelative,
          role: "resolve written content for lockfile",
          cause: new Error(`invariant: content missing for ${targetRelative}`),
        }),
      );
    }
    const targetHash = hashBytes(
      typeof content === "string" ? Buffer.from(content, "utf8") : content,
    );
    const adapterResult = await adapterLockEntry(write);
    if (!adapterResult.ok) return adapterResult;

    targetEntries.push({
      write,
      targetHash,
      adapter: adapterResult.value,
    });
  }

  return buildLockfileFromTargetEntries(plan, targetEntries);
}

async function adapterLockEntry(
  write: PlanFileWrite,
): Promise<Result<LockfileTargetAdapter, SyncFileError>> {
  const adapterSource = writeAdapterSource(write);
  if (!adapterSource) return ResultKit.success({ kind: "none" });

  const adapterBytesResult = await ResultKit.fromPromise(
    Bun.file(adapterSource).bytes(),
    (cause) =>
      syncFileError({
        type: "sync_file_read_error",
        path: adapterSource,
        role: "read lockfile adapter",
        cause,
      }),
  );
  if (!adapterBytesResult.ok) return adapterBytesResult;

  return ResultKit.success({
    kind: "applied",
    source: relative(writeLibraryRoot(write), adapterSource),
    hash: hashBytes(adapterBytesResult.value),
  });
}
