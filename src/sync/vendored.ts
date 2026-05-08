import { join, relative } from "node:path";
import type { Lockfile } from "../lockfile/schema.ts";
import { hashBytes, hashFile } from "../lockfile/hash.ts";
import { readLockfile, type LockfileReadError } from "../lockfile/read.ts";
import { writeLockfile, type LockfileWriteError } from "../lockfile/write.ts";
import { writeFileAtomic } from "../util/fs.ts";
import type { PlanFileWrite, SyncPlan } from "./plan.ts";
import { buildContent, type SyncRunOptions } from "./generated.ts";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
// @ts-ignore — resolveJsonModule + allowImportingTsExtensions handles this
import pkg from "../../package.json";

export interface VendoredSkippedFile {
  path: string;
  sourceArtifact: string;
  reason: "locally edited" | "pre-existing file, no lockfile to verify ownership";
}

export interface VendoredSyncResult {
  written: number;
  skipped: VendoredSkippedFile[];
}

export type VendoredSyncError = LockfileReadError | LockfileWriteError;

interface PreviousTargetEntry {
  targetHash: string;
  adapterSource: string | null;
  adapterHash: string | null;
}

interface TargetLockEntry {
  write: PlanFileWrite;
  targetHash: string;
  adapterSource: string | null;
  adapterHash: string | null;
}

export async function runVendoredSync(
  plan: SyncPlan,
  options: SyncRunOptions = {},
): Promise<Result<VendoredSyncResult, VendoredSyncError>> {
  if (options.dryRun) {
    for (const w of plan.writes) {
      process.stdout.write(`[dry-run] would write ${w.targetRelative}\n`);
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
    const previous = previousTargets.get(w.targetRelative) ?? null;
    const targetExists = await Bun.file(w.targetFile).exists();
    const content = await buildContent(w, plan);

    if (!targetExists) {
      await writeFileAtomic(w.targetFile, content);
      writtenContents.set(w.targetRelative, content);
      targetEntries.push(await writtenTargetEntry(w, content));
      continue;
    }

    if (!previous) {
      skipped.push({
        path: w.targetRelative,
        sourceArtifact: w.artifactId,
        reason: "pre-existing file, no lockfile to verify ownership",
      });
      continue;
    }

    const currentTargetHash = await hashFile(w.targetFile);
    if (currentTargetHash === previous.targetHash) {
      await writeFileAtomic(w.targetFile, content);
      writtenContents.set(w.targetRelative, content);
      targetEntries.push(await writtenTargetEntry(w, content));
      continue;
    }

    skipped.push({
      path: w.targetRelative,
      sourceArtifact: w.artifactId,
      reason: "locally edited",
    });
    targetEntries.push({
      write: w,
      targetHash: previous.targetHash,
      adapterSource: previous.adapterSource,
      adapterHash: previous.adapterHash,
    });
  }

  const lockfile = await buildVendoredLockfile(plan, targetEntries);
  const writeResult = await writeLockfile(lockfilePath, lockfile);
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
          adapterSource: target.adapterSource,
          adapterHash: target.adapterHash,
        });
      }
    }
  }

  return targets;
}

async function writtenTargetEntry(
  write: PlanFileWrite,
  content: string | Uint8Array,
): Promise<TargetLockEntry> {
  let adapterHash: string | null = null;
  if (write.adapterSource) {
    const adapterBytes = await Bun.file(write.adapterSource).bytes();
    adapterHash = hashBytes(adapterBytes);
  }

  return {
    write,
    targetHash: hashBytes(
      typeof content === "string" ? Buffer.from(content, "utf8") : content,
    ),
    adapterSource: write.adapterSource
      ? relative(write.libraryRoot, write.adapterSource)
      : null,
    adapterHash,
  };
}

async function buildVendoredLockfile(
  plan: SyncPlan,
  targetEntries: TargetLockEntry[],
): Promise<Lockfile> {
  const byArtifact = new Map<string, Map<string, TargetLockEntry[]>>();

  for (const entry of targetEntries) {
    const artifactEntries = byArtifact.get(entry.write.artifactId) ?? new Map();
    const fileEntries = artifactEntries.get(entry.write.sourceFile) ?? [];
    fileEntries.push(entry);
    artifactEntries.set(entry.write.sourceFile, fileEntries);
    byArtifact.set(entry.write.artifactId, artifactEntries);
  }

  const artifacts: Lockfile["artifacts"] = [];

  for (const [artifactId, bySource] of byArtifact) {
    const firstEntry = bySource.values().next().value![0] as TargetLockEntry;
    const files: Lockfile["artifacts"][number]["files"] = [];

    for (const [sourceFile, entries] of bySource) {
      const sourceBytes = await Bun.file(sourceFile).bytes();
      const sourceHash = hashBytes(sourceBytes);
      const relSource = relative(firstEntry.write.libraryRoot, sourceFile);

      files.push({
        source: relSource,
        sourceHash,
        targets: entries.map((entry) => ({
          path: entry.write.targetRelative,
          targetHash: entry.targetHash,
          adapterSource: entry.adapterSource,
          adapterHash: entry.adapterHash,
        })),
      });
    }

    artifacts.push({
      id: artifactId,
      kind: firstEntry.write.artifactKind,
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
