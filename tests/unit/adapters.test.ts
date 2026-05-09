import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";
import { mergeWithAdapter, findAdapter } from "../../src/sync/adapters.ts";
import type { Artifact } from "../../src/artifact/types.ts";

const HOME = resolve("tests/fixtures/home-min");

function makeSkillArtifact(): Artifact {
  return {
    id: "frontend/skills/react-useeffect",
    kind: "skill",
    sourceRoot: resolve(HOME, "frontend/skills/react-useeffect"),
    domain: "frontend",
    basename: "react-useeffect",
    libraryRoot: HOME,
  };
}

function makeAgentArtifact(): Artifact {
  return {
    id: "global/agents/security-reviewer",
    kind: "agent",
    sourceRoot: resolve(HOME, "global/agents/security-reviewer.md"),
    domain: "global",
    basename: "security-reviewer",
    libraryRoot: HOME,
  };
}

describe("mergeWithAdapter", () => {
  it("combines header + neutral source + adapter, in that order", () => {
    const out = mergeWithAdapter({
      header: "<!-- HDR -->",
      neutral: "# Body\n",
      adapter: "Adapter line.\n",
    });
    expect(out).toBe("<!-- HDR -->\n# Body\nAdapter line.\n");
  });

  it("adds trailing newline to neutral when missing before appending adapter", () => {
    const out = mergeWithAdapter({
      header: "<!-- HDR -->",
      neutral: "# Body",
      adapter: "Adapter line.\n",
    });
    expect(out).toBe("<!-- HDR -->\n# Body\nAdapter line.\n");
  });

  it("omits adapter when null", () => {
    const out = mergeWithAdapter({
      header: "<!-- HDR -->",
      neutral: "# Body\n",
      adapter: null,
    });
    expect(out).toBe("<!-- HDR -->\n# Body\n");
  });

  it("inserts the header after YAML frontmatter when requested", () => {
    const out = mergeWithAdapter({
      header: "<!-- HDR -->",
      neutral: "---\nname: example\ndescription: Example skill.\n---\n\n# Body\n",
      adapter: null,
      preserveFrontmatter: true,
    });
    expect(out).toBe(
      "---\nname: example\ndescription: Example skill.\n---\n<!-- HDR -->\n\n# Body\n",
    );
  });
});

describe("findAdapter", () => {
  it("finds skill claude adapter", () => {
    const result = findAdapter(makeSkillArtifact(), "claude");
    expect(result).not.toBeNull();
    expect(result!.sourcePath).toContain("adapters/claude.md");
  });

  it("finds skill codex adapter", () => {
    const result = findAdapter(makeSkillArtifact(), "codex");
    expect(result).not.toBeNull();
    expect(result!.sourcePath).toContain("adapters/codex.md");
  });

  it("finds agent claude adapter via sibling .adapters dir", () => {
    const result = findAdapter(makeAgentArtifact(), "claude");
    expect(result).not.toBeNull();
    expect(result!.sourcePath).toContain(
      "security-reviewer.adapters/claude.md",
    );
  });

  it("returns null when adapter does not exist", () => {
    // No codex adapter for security-reviewer in fixtures
    const result = findAdapter(makeAgentArtifact(), "codex");
    expect(result).toBeNull();
  });
});
