import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { Artifact } from "../artifact/types.ts";
import type { TargetDir } from "../artifact/target.ts";

export interface MergeWithAdapterOptions {
  header: string;
  neutral: string;
  adapter: string | null;
}

/**
 * Merge header, neutral source body, and optional adapter content in stable order:
 * header + newline + neutral + adapter (if present).
 */
export function mergeWithAdapter(opts: MergeWithAdapterOptions): string {
  const { header, neutral, adapter } = opts;
  const normalizedNeutral = neutral.endsWith("\n") ? neutral : neutral + "\n";
  if (adapter === null) {
    return `${header}\n${normalizedNeutral}`;
  }
  return `${header}\n${normalizedNeutral}${adapter}`;
}

export interface AdapterResult {
  sourcePath: string;
}

/**
 * Locate the adapter file for an artifact on a given target side.
 * Returns the adapter source path when the file exists, or null.
 * Content is intentionally not read here — callers read it async during write.
 *
 * Skills:     <artifact.sourceRoot>/adapters/<target>.md
 * Commands/Agents: <dirname(sourceRoot)>/<basename>.adapters/<target>.md
 */
export function findAdapter(
  artifact: Artifact,
  target: TargetDir,
): AdapterResult | null {
  let adapterPath: string;

  if (artifact.kind === "skill") {
    adapterPath = join(artifact.sourceRoot, "adapters", `${target}.md`);
  } else {
    // command / agent: sourceRoot is the .md file path
    const dir = dirname(artifact.sourceRoot);
    adapterPath = join(dir, `${artifact.basename}.adapters`, `${target}.md`);
  }

  // existsSync is acceptable per CONTEXT.md — no Bun sync stat equivalent
  if (!existsSync(adapterPath)) {
    return null;
  }

  return { sourcePath: adapterPath };
}
