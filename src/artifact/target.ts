import { join } from "node:path";
import {
  absolutePath,
  relativePath as toRelativePath,
  type AbsolutePath,
  type Artifact,
  type RelativePath,
} from "./types.ts";

export type TargetDir = "codex" | "claude";
export type TargetSelection = TargetDir | "both";

/** Map a TargetDir to the filesystem directory name. */
export const TARGET_DIR_NAME: Record<TargetDir, string> = {
  codex: ".agents",
  claude: ".claude",
};

export interface TargetFileSpec {
  /** The target directory ('codex' or 'claude'). */
  readonly targetDir: TargetDir;
  /** Absolute path to the target file. */
  readonly filePath: AbsolutePath;
  /** Path relative to projectRoot, e.g. '.claude/skills/react-useeffect/SKILL.md' */
  readonly relativePath: RelativePath;
}

/**
 * Compute target file specs for an artifact given a project root and target setting.
 * target='both' yields one spec per target dir (.agents, .claude).
 * Only handles the primary artifact file (SKILL.md / command .md / agent .md).
 * Bundled skill files are handled separately in the plan builder.
 */
export function computeTargetSpecs(
  artifact: Artifact,
  projectRoot: string,
  target: TargetSelection,
): TargetFileSpec[] {
  const dirs: TargetDir[] = target === "both" ? ["codex", "claude"] : [target];

  return dirs.map((dir) => {
    const dirName = TARGET_DIR_NAME[dir];
    let targetRelative: string;

    if (artifact.kind === "skill") {
      targetRelative = join(dirName, "skills", artifact.basename, "SKILL.md");
    } else if (artifact.kind === "command") {
      targetRelative = join(dirName, "commands", `${artifact.basename}.md`);
    } else {
      // agent
      targetRelative = join(dirName, "agents", `${artifact.basename}.md`);
    }

    return {
      targetDir: dir,
      filePath: absolutePath(join(projectRoot, targetRelative)),
      relativePath: toRelativePath(targetRelative),
    };
  });
}

export function computeBundledSkillTargetSpec(input: {
  readonly projectRoot: string;
  readonly targetDir: TargetDir;
  readonly basename: string;
  readonly relativeSourcePath: string;
}): TargetFileSpec {
  const dirName = TARGET_DIR_NAME[input.targetDir];
  const targetRelative = join(
    dirName,
    "skills",
    input.basename,
    input.relativeSourcePath,
  );

  return {
    targetDir: input.targetDir,
    filePath: absolutePath(join(input.projectRoot, targetRelative)),
    relativePath: toRelativePath(targetRelative),
  };
}
