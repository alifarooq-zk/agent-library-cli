import { join, relative, extname } from "node:path";
// Bun has no sync dir-walk API; node:fs is intentional here
import { readdirSync, statSync } from "node:fs";
import {
  absolutePath,
  type AbsolutePath,
  type Artifact,
  type RelativePath,
} from "../artifact/types.ts";
import type { Manifest } from "../manifest/schema.ts";
import {
  computeBundledSkillTargetSpec,
  computeTargetSpecs,
  type TargetFileSpec,
  type TargetDir,
  type TargetSelection,
} from "../artifact/target.ts";
import { findAdapter } from "./adapters.ts";

export type PlannedContentKind = "markdown" | "binary";

export interface PlannedSourceFile {
  readonly filePath: AbsolutePath;
  readonly contentKind: PlannedContentKind;
  readonly preserveFrontmatter: boolean;
}

export type PlanAdapterSpec =
  | { readonly kind: "none" }
  | { readonly kind: "applied"; readonly sourceFile: AbsolutePath };

export interface PlanFileWrite {
  readonly artifact: Artifact;
  readonly source: PlannedSourceFile;
  readonly target: TargetFileSpec;
  readonly adapter: PlanAdapterSpec;
}

export interface SyncPlan {
  readonly mode: "generated" | "vendored";
  readonly target: TargetSelection;
  readonly projectRoot: AbsolutePath;
  /** Original manifest include entries (for lockfile). */
  readonly include: readonly string[];
  readonly writes: readonly PlanFileWrite[];
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
        const adapter = findAdapter(artifact, spec.targetDir);
        writes.push(
          plannedWrite({
            artifact,
            sourceFile: artifact.primarySourceFile,
            contentKind: "markdown",
            preserveFrontmatter: true,
            target: spec,
            adapterSource: adapter ? adapter.sourcePath : null,
          }),
        );
      }

      // Bundled files: everything in the skill folder except SKILL.md and adapters/
      const allFiles = collectFiles(artifact.rootDir, "adapters");
      for (const absFile of allFiles) {
        const relFromSkillRoot = relative(artifact.rootDir, absFile);
        if (relFromSkillRoot === "SKILL.md") continue; // already handled above

        const isMarkdown = extname(absFile).toLowerCase() === ".md";

        for (const dir of targetDirs) {
          writes.push(
            plannedWrite({
              artifact,
              sourceFile: absFile,
              contentKind: isMarkdown ? "markdown" : "binary",
              preserveFrontmatter: isMarkdown,
              target: computeBundledSkillTargetSpec({
                projectRoot,
                targetDir: dir,
                basename: artifact.basename,
                relativeSourcePath: relFromSkillRoot,
              }),
              adapterSource: null,
            }),
          );
        }
      }
    } else if (artifact.kind === "command" || artifact.kind === "agent") {
      const specs = computeTargetSpecs(artifact, projectRoot, manifest.target);
      for (const spec of specs) {
        const adapter = findAdapter(artifact, spec.targetDir);
        writes.push(
          plannedWrite({
            artifact,
            sourceFile: artifact.sourceFile,
            contentKind: "markdown",
            preserveFrontmatter: false,
            target: spec,
            adapterSource: adapter ? adapter.sourcePath : null,
          }),
        );
      }
    }
  }

  return {
    mode: manifest.mode,
    target: manifest.target,
    projectRoot: absolutePath(projectRoot),
    include: manifest.include,
    writes,
  };
}

function plannedWrite(input: {
  readonly artifact: Artifact;
  readonly sourceFile: string;
  readonly contentKind: PlannedContentKind;
  readonly preserveFrontmatter: boolean;
  readonly target: TargetFileSpec;
  readonly adapterSource: string | null;
}): PlanFileWrite {
  return {
    artifact: input.artifact,
    source: {
      filePath: absolutePath(input.sourceFile),
      contentKind: input.contentKind,
      preserveFrontmatter: input.preserveFrontmatter,
    },
    target: input.target,
    adapter: input.adapterSource
      ? { kind: "applied", sourceFile: absolutePath(input.adapterSource) }
      : { kind: "none" },
  };
}

export function writeArtifactId(write: PlanFileWrite): string {
  return write.artifact.id;
}

export function writeArtifactKind(write: PlanFileWrite): Artifact["kind"] {
  return write.artifact.kind;
}

export function writeLibraryRoot(write: PlanFileWrite): AbsolutePath {
  return write.artifact.libraryRoot;
}

export function writeSourceFile(write: PlanFileWrite): AbsolutePath {
  return write.source.filePath;
}

export function writeTargetFile(write: PlanFileWrite): AbsolutePath {
  return write.target.filePath;
}

export function writeTargetRelative(write: PlanFileWrite): RelativePath {
  return write.target.relativePath;
}

export function writeAdapterSource(write: PlanFileWrite): AbsolutePath | null {
  return write.adapter.kind === "applied" ? write.adapter.sourceFile : null;
}
