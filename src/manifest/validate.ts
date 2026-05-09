import { join } from "node:path";
import { parseDocument } from "yaml";
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
 * Validate SKILL.md frontmatter against the Agent Skills spec.
 * Accepts pre-resolved artifacts so the caller avoids a redundant resolve pass.
 * Returns Issues for invalid skills.
 */
export async function validateSkillSpecs(
  artifacts: Artifact[],
): Promise<Issue[]> {
  const issues: Issue[] = [];

  for (const artifact of artifacts) {
    if (artifact.kind !== "skill") continue;
    const skillMdPath = join(artifact.sourceRoot, "SKILL.md");
    const skillMdFile = Bun.file(skillMdPath);
    if (!(await skillMdFile.exists())) continue;

    const raw = await skillMdFile.text();
    const frontmatter = extractSkillFrontmatter(raw);

    if (!frontmatter.ok) {
      issues.push({
        path: artifact.id,
        message: frontmatter.message,
      });
      continue;
    }

    const name = frontmatter.value.name;
    if (typeof name !== "string" || name.length === 0) {
      issues.push({
        path: artifact.id,
        message: "SKILL.md frontmatter must include a non-empty string name",
      });
    } else if (name.length > 64) {
      issues.push({
        path: artifact.id,
        message: "SKILL.md name must be 64 characters or fewer",
      });
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      issues.push({
        path: artifact.id,
        message:
          "SKILL.md name must use lowercase letters, numbers, and single hyphens only",
      });
    } else if (name !== artifact.basename) {
      issues.push({
        path: artifact.id,
        message: `SKILL.md name '${name}' does not match folder basename '${artifact.basename}'`,
      });
    }

    const description = frontmatter.value.description;
    if (typeof description !== "string" || description.length === 0) {
      issues.push({
        path: artifact.id,
        message:
          "SKILL.md frontmatter must include a non-empty string description",
      });
    } else if (description.length > 1024) {
      issues.push({
        path: artifact.id,
        message: "SKILL.md description must be 1024 characters or fewer",
      });
    }
  }

  return issues;
}

/**
 * Backwards-compatible name for callers/tests that only cared about name checks.
 */
export const validateSkillNames = validateSkillSpecs;

function extractSkillFrontmatter(
  content: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {
      ok: false,
      message: "SKILL.md is missing YAML frontmatter delimited by ---",
    };
  }

  const doc = parseDocument(match[1], { prettyErrors: false });
  if (doc.errors.length > 0) {
    return { ok: false, message: "SKILL.md frontmatter is invalid YAML" };
  }

  const value = doc.toJS() as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      message: "SKILL.md frontmatter must be a YAML mapping",
    };
  }

  return { ok: true, value: value as Record<string, unknown> };
}
