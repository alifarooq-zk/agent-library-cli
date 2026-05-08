import { join, relative, extname } from "node:path";
// Bun has no sync dir-walk API; node:fs is intentional here
import { readdirSync, statSync } from "node:fs";
import type { Artifact } from "../artifact/types.ts";
import type { Manifest } from "../manifest/schema.ts";
import {
  computeTargetSpecs,
  TARGET_DIR_NAME,
  type TargetDir,
} from "../artifact/target.ts";
import { findAdapter } from "./adapters.ts";

export interface PlanFileWrite {
  artifactId: string;
  artifactKind: "skill" | "command" | "agent";
  /** Absolute path to the source file. */
  sourceFile: string;
  /** Absolute path to the target file under projectRoot. */
  targetFile: string;
  /** Path relative to projectRoot. */
  targetRelative: string;
  /** Whether this is a markdown file (gets a header prepended). */
  isMarkdown: boolean;
  /** Target side: 'codex' or 'claude'. */
  targetDir: TargetDir;
  /**
   * Absolute path to the adapter source file for this target, or null if no adapter exists.
   * Populated only for primary markdown files (SKILL.md / command / agent).
   */
  adapterSource: string | null;
  /** Absolute path to the library root that owns this artifact (for computing relative source paths). */
  libraryRoot: string;
}

export interface SyncPlan {
  mode: "generated" | "vendored";
  target: "codex" | "claude" | "both";
  projectRoot: string;
  /** Original manifest include entries (for lockfile). */
  include: string[];
  writes: PlanFileWrite[];
}

/**
 * Recursively collect all files under a directory, skipping any directory
 * whose name matches `skipDirName` at any level.
 */
function collectFiles(
  dir: string,
  skipDirName: string,
  results: string[] = [],
): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry !== skipDirName) collectFiles(fullPath, skipDirName, results);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Build the full sync plan from a resolved manifest and artifact list.
 * Handles skills (SKILL.md + bundled files), commands, and agents.
 */
export function buildPlan(
  manifest: Manifest,
  artifacts: Artifact[],
  projectRoot: string,
): SyncPlan {
  const writes: PlanFileWrite[] = [];
  const targetDirs: TargetDir[] =
    manifest.target === "both" ? ["codex", "claude"] : [manifest.target];

  for (const artifact of artifacts) {
    if (artifact.kind === "skill") {
      const specs = computeTargetSpecs(artifact, projectRoot, manifest.target);

      // Primary file: SKILL.md
      for (const spec of specs) {
        const sourceFile = join(artifact.sourceRoot, "SKILL.md");
        const adapter = findAdapter(artifact, spec.targetDir);
        writes.push({
          artifactId: artifact.id,
          artifactKind: artifact.kind,
          sourceFile,
          targetFile: spec.filePath,
          targetRelative: spec.relativePath,
          isMarkdown: true,
          targetDir: spec.targetDir,
          adapterSource: adapter ? adapter.sourcePath : null,
          libraryRoot: artifact.libraryRoot,
        });
      }

      // Bundled files: everything in the skill folder except SKILL.md and adapters/
      const allFiles = collectFiles(artifact.sourceRoot, "adapters");
      for (const absFile of allFiles) {
        const relFromSkillRoot = relative(artifact.sourceRoot, absFile);
        if (relFromSkillRoot === "SKILL.md") continue; // already handled above

        const isMarkdown = extname(absFile).toLowerCase() === ".md";

        for (const dir of targetDirs) {
          const dirName = TARGET_DIR_NAME[dir];
          const targetRelative = join(
            dirName,
            "skills",
            artifact.basename,
            relFromSkillRoot,
          );
          writes.push({
            adapterSource: null,
            artifactId: artifact.id,
            artifactKind: artifact.kind,
            sourceFile: absFile,
            targetFile: join(projectRoot, targetRelative),
            targetRelative,
            isMarkdown,
            targetDir: dir,
            libraryRoot: artifact.libraryRoot,
          });
        }
      }
    } else if (artifact.kind === "command" || artifact.kind === "agent") {
      // sourceRoot for commands/agents is the absolute path to the .md file itself
      const specs = computeTargetSpecs(artifact, projectRoot, manifest.target);
      for (const spec of specs) {
        const adapter = findAdapter(artifact, spec.targetDir);
        writes.push({
          artifactId: artifact.id,
          artifactKind: artifact.kind,
          sourceFile: artifact.sourceRoot,
          targetFile: spec.filePath,
          targetRelative: spec.relativePath,
          isMarkdown: true,
          targetDir: spec.targetDir,
          adapterSource: adapter ? adapter.sourcePath : null,
          libraryRoot: artifact.libraryRoot,
        });
      }
    }
  }

  return {
    mode: manifest.mode,
    target: manifest.target,
    projectRoot,
    include: manifest.include,
    writes,
  };
}
