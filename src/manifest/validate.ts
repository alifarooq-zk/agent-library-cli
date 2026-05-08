import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ManifestSchema } from "./schema.ts";
import type { Artifact } from "../artifact/types.ts";
import type { ResolveCtx } from "../resolve/sources.ts";
import { resolveIncludes } from "../resolve/sources.ts";

export interface Issue {
  path: string;
  message: string;
}

export function validateManifest(input: unknown): Issue[] {
  const r = ManifestSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}

/**
 * Validate that all include entries in a structurally-valid manifest can be resolved.
 * Returns an Issue for each entry that fails to resolve (path = 'include[i]').
 */
export async function validateResolve(
  input: unknown,
  ctx: ResolveCtx,
): Promise<Issue[]> {
  const r = ManifestSchema.safeParse(input);
  if (!r.success) return [];

  const issues: Issue[] = [];
  const entries = r.data.include as string[];

  for (let i = 0; i < entries.length; i++) {
    const result = await resolveIncludes([entries[i]], ctx);
    if (!result.ok) {
      issues.push({
        path: `include[${i}]`,
        message: result.error.message,
      });
    }
  }

  return issues;
}

/**
 * Validate SKILL.md frontmatter: the `name:` field must match the folder basename.
 * Accepts pre-resolved artifacts so the caller avoids a redundant resolve pass.
 * Returns one Issue per mismatched skill.
 */
export async function validateSkillNames(
  artifacts: Artifact[],
): Promise<Issue[]> {
  const issues: Issue[] = [];

  for (const artifact of artifacts) {
    if (artifact.kind !== "skill") continue;
    const skillMdPath = join(artifact.sourceRoot, "SKILL.md");
    const skillMdFile = Bun.file(skillMdPath);
    if (!(await skillMdFile.exists())) continue;

    const raw = await skillMdFile.text();
    const frontmatterName = extractFrontmatterName(raw);
    if (frontmatterName !== null && frontmatterName !== artifact.basename) {
      issues.push({
        path: artifact.id,
        message: `SKILL.md name '${frontmatterName}' does not match folder basename '${artifact.basename}'`,
      });
    }
  }

  return issues;
}

/**
 * Extract the `name:` value from a YAML frontmatter block at the top of a markdown file.
 * Returns null if no frontmatter block is found or `name` is absent.
 */
function extractFrontmatterName(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    const fm = parseYaml(match[1]) as Record<string, unknown>;
    if (typeof fm?.name === "string") return fm.name;
  } catch {
    // malformed frontmatter — treat as no name
  }
  return null;
}
