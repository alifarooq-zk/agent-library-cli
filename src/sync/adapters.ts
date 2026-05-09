import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { Artifact } from "../artifact/types.ts";
import type { TargetDir } from "../artifact/target.ts";

export interface MergeWithAdapterOptions {
  header: string;
  neutral: string;
  adapter: string | null;
  preserveFrontmatter?: boolean;
}

/**
 * Merge header, neutral source body, and optional adapter content.
 * Default order: header + newline + neutral + adapter (if present).
 * When preserveFrontmatter is true and neutral begins with YAML frontmatter,
 * the order is: frontmatter + header + newline + body + adapter (if present).
 */
export function mergeWithAdapter(opts: MergeWithAdapterOptions): string {
  const { header, neutral, adapter, preserveFrontmatter = false } = opts;
  const normalizedNeutral = neutral.endsWith("\n") ? neutral : neutral + "\n";
  const content = preserveFrontmatter
    ? insertHeaderAfterFrontmatter(normalizedNeutral, header)
    : `${header}\n${normalizedNeutral}`;

  if (adapter === null) {
    return content;
  }
  return `${content}${adapter}`;
}

function insertHeaderAfterFrontmatter(content: string, header: string): string {
  const frontmatterEnd = findYamlFrontmatterEnd(content);
  if (frontmatterEnd === null) {
    return `${header}\n${content}`;
  }

  const frontmatter = content.slice(0, frontmatterEnd);
  const separator = frontmatter.endsWith("\n") ? "" : "\n";
  return `${frontmatter}${separator}${header}\n${content.slice(frontmatterEnd)}`;
}

export function findYamlFrontmatterEnd(content: string): number | null {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return null;
  return match[0].length;
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
