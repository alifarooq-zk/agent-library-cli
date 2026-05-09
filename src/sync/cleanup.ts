import { join } from "node:path";
import { existsSync, readdirSync, rmdirSync } from "node:fs";
import type { Lockfile } from "../lockfile/schema.ts";
import { GENERATED_MARKER } from "./header.ts";
import { findYamlFrontmatterEnd } from "./adapters.ts";

export interface CleanupResult {
  removed: number;
  skipped: { path: string; reason: string }[];
}

export interface StaleGeneratedTarget {
  path: string;
}

/**
 * Diff previous lockfile target paths against new plan target paths.
 * For each removed target path:
 *   - If the file does not start with the generated marker, log a warning and skip.
 *   - Otherwise delete the file. Then walk parent directories and remove any that became empty.
 * Returns { removed, skipped }.
 */
export async function cleanupStaleFiles(
  projectRoot: string,
  previousLockfile: Lockfile,
  newTargetPaths: Set<string>,
): Promise<CleanupResult> {
  const stale = await findStaleGeneratedTargets(
    projectRoot,
    previousLockfile,
    newTargetPaths,
  );
  const removed: string[] = [];

  for (const target of stale.removable) {
    const absPath = join(projectRoot, target.path);
    await Bun.file(absPath).delete();
    removed.push(absPath);
    removeEmptyParents(absPath, projectRoot);
  }

  return { removed: removed.length, skipped: stale.skipped };
}

export async function findStaleGeneratedTargets(
  projectRoot: string,
  previousLockfile: Lockfile,
  newTargetPaths: Set<string>,
): Promise<{
  removable: StaleGeneratedTarget[];
  skipped: { path: string; reason: string }[];
}> {
  const removable: StaleGeneratedTarget[] = [];
  const skipped: { path: string; reason: string }[] = [];

  // Collect all target paths from the previous lockfile
  for (const artifact of previousLockfile.artifacts) {
    for (const file of artifact.files) {
      for (const target of file.targets) {
        const relPath = target.path;
        if (newTargetPaths.has(relPath)) continue; // still referenced

        const absPath = join(projectRoot, relPath);
        if (!existsSync(absPath)) continue; // already gone

        const content = await Bun.file(absPath).text();
        if (!hasGeneratedOwnershipHeader(content)) {
          skipped.push({
            path: relPath,
            reason: "file does not carry the generated ownership header",
          });
          continue;
        }

        removable.push({ path: relPath });
      }
    }
  }

  return { removable, skipped };
}

function hasGeneratedOwnershipHeader(content: string): boolean {
  const headerStart = findGeneratedOwnershipHeaderStart(content);
  if (headerStart === null) return false;

  const headerEnd = content.indexOf("\n-->", headerStart);
  if (headerEnd === -1) return false;

  const header = content.slice(headerStart, headerEnd);
  return header.includes("\nSource: ") && header.includes("\nMode: generated");
}

function findGeneratedOwnershipHeaderStart(content: string): number | null {
  const markerPrefix = `<!--\n${GENERATED_MARKER}\n`;
  if (content.startsWith(markerPrefix)) return 0;

  const frontmatterEnd = findYamlFrontmatterEnd(content);
  if (frontmatterEnd === null) return null;

  const afterFrontmatter = content.slice(frontmatterEnd);
  if (!afterFrontmatter.startsWith(markerPrefix)) return null;
  return frontmatterEnd;
}

/**
 * Walk up from `filePath` to `stopAt`, removing directories that become empty.
 */
function removeEmptyParents(filePath: string, stopAt: string): void {
  let dir = filePath;
  while (true) {
    // Move up one level
    const parent = join(dir, "..");
    if (parent === dir || parent === stopAt || !parent.startsWith(stopAt))
      break;
    dir = parent;

    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      if (entries.length === 0) {
        rmdirSync(dir);
      } else {
        break; // not empty; stop walking up
      }
    } catch {
      break;
    }
  }
}
