import { join } from "node:path";
import type { Artifact } from "./types.ts";

export type TargetDir = "codex" | "claude";

/** Map a TargetDir to the filesystem directory name. */
export const TARGET_DIR_NAME: Record<TargetDir, string> = {
  codex: ".agents",
  claude: ".claude",
};

export interface TargetFileSpec {
  /** The target directory ('codex' or 'claude'). */
  targetDir: TargetDir;
  /** Absolute path to the target file. */
  filePath: string;
  /** Path relative to projectRoot, e.g. '.claude/skills/react-useeffect/SKILL.md' */
  relativePath: string;
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
  target: "codex" | "claude" | "both",
): TargetFileSpec[] {
  const dirs: TargetDir[] = target === "both" ? ["codex", "claude"] : [target];

  return dirs.map((dir) => {
    const dirName = TARGET_DIR_NAME[dir];
    let relativePath: string;

    if (artifact.kind === "skill") {
      relativePath = join(dirName, "skills", artifact.basename, "SKILL.md");
    } else if (artifact.kind === "command") {
      relativePath = join(dirName, "commands", `${artifact.basename}.md`);
    } else {
      // agent
      relativePath = join(dirName, "agents", `${artifact.basename}.md`);
    }

    return {
      targetDir: dir,
      filePath: join(projectRoot, relativePath),
      relativePath,
    };
  });
}
