import { join, basename } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import type { Artifact, ArtifactKind } from "./types.ts";

const SKILL_KINDS = ["skills"] as const;
const COMMAND_KINDS = ["commands", "command"] as const;
const AGENT_KINDS = ["agents"] as const;

/**
 * Try to classify a single named path under a domain root.
 * Returns an Artifact or null if the path doesn't match any known pattern.
 */
export function classifyArtifact(
  libraryRoot: string,
  domain: string,
  category: string,
  name: string,
): Artifact | null {
  if (SKILL_KINDS.includes(category as (typeof SKILL_KINDS)[number])) {
    const dir = join(libraryRoot, domain, category, name);
    if (existsSync(join(dir, "SKILL.md"))) {
      return {
        id: `${domain}/${category}/${name}`,
        kind: "skill",
        sourceRoot: dir,
        domain,
        basename: name,
        libraryRoot,
      };
    }
    return null;
  }

  if (COMMAND_KINDS.includes(category as (typeof COMMAND_KINDS)[number])) {
    // name here is the stem (without .md)
    const file = join(libraryRoot, domain, category, `${name}.md`);
    if (existsSync(file)) {
      return {
        id: `${domain}/${category}/${name}`,
        kind: "command",
        sourceRoot: file,
        domain,
        basename: name,
        libraryRoot,
      };
    }
    return null;
  }

  if (AGENT_KINDS.includes(category as (typeof AGENT_KINDS)[number])) {
    const file = join(libraryRoot, domain, category, `${name}.md`);
    if (existsSync(file)) {
      return {
        id: `${domain}/${category}/${name}`,
        kind: "agent",
        sourceRoot: file,
        domain,
        basename: name,
        libraryRoot,
      };
    }
    return null;
  }

  return null;
}

/**
 * Walk a domain directory and return all artifacts found, sorted by id.
 */
export function discoverDomain(
  libraryRoot: string,
  domain: string,
): Artifact[] {
  const domainDir = join(libraryRoot, domain);
  if (!existsSync(domainDir)) return [];

  const results: Artifact[] = [];

  for (const category of readdirSync(domainDir)) {
    const categoryPath = join(domainDir, category);
    if (!statSync(categoryPath).isDirectory()) continue;

    const isSkillCategory = SKILL_KINDS.includes(
      category as (typeof SKILL_KINDS)[number],
    );
    const isCommandCategory = COMMAND_KINDS.includes(
      category as (typeof COMMAND_KINDS)[number],
    );
    const isAgentCategory = AGENT_KINDS.includes(
      category as (typeof AGENT_KINDS)[number],
    );

    if (!isSkillCategory && !isCommandCategory && !isAgentCategory) continue;

    for (const entry of readdirSync(categoryPath)) {
      const entryPath = join(categoryPath, entry);
      const stat = statSync(entryPath);

      if (isSkillCategory && stat.isDirectory()) {
        const artifact = classifyArtifact(libraryRoot, domain, category, entry);
        if (artifact) results.push(artifact);
      } else if (
        (isCommandCategory || isAgentCategory) &&
        !stat.isDirectory() &&
        entry.endsWith(".md")
      ) {
        const stem = entry.slice(0, -3); // strip .md
        const artifact = classifyArtifact(libraryRoot, domain, category, stem);
        if (artifact) results.push(artifact);
      }
    }
  }

  return results.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Discover all domains in a library root (subdirectories that aren't 'profiles').
 */
export function discoverDomains(libraryRoot: string): string[] {
  if (!existsSync(libraryRoot)) return [];
  return readdirSync(libraryRoot)
    .filter((entry) => {
      if (entry === "profiles") return false;
      return statSync(join(libraryRoot, entry)).isDirectory();
    })
    .sort();
}
