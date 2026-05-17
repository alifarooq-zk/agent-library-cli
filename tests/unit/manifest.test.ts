import { describe, it, expect } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  formatIssue,
  validateManifest,
  validateSkillSpecs,
} from "../../src/manifest/validate.ts";
import { ManifestSchema } from "../../src/manifest/schema.ts";
import { loadManifest } from "../../src/manifest/load.ts";
import {
  createSkillArtifact,
  type Artifact,
} from "../../src/artifact/types.ts";

describe("validateManifest", () => {
  it("accepts a fully populated valid manifest", async () => {
    const result = await loadManifest("tests/fixtures/manifests/valid.yml");
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues).toEqual([]);
  });

  it("rejects missing version with a field-specific message", async () => {
    const result = await loadManifest(
      "tests/fixtures/manifests/missing-version.yml",
    );
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("version");
    expect(issues[0].message).toMatch(/required/i);
  });

  it("rejects unknown mode value", async () => {
    const result = await loadManifest("tests/fixtures/manifests/bad-mode.yml");
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues[0].path).toBe("mode");
    expect(issues[0].message).toMatch(/generated|vendored/);
  });

  it("rejects unknown target value", async () => {
    const result = await loadManifest(
      "tests/fixtures/manifests/bad-target.yml",
    );
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues[0].path).toBe("target");
  });

  it("rejects empty include array", async () => {
    const result = await loadManifest(
      "tests/fixtures/manifests/empty-include.yml",
    );
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues[0].path).toBe("include");
    expect(issues[0].message).toMatch(/non-empty|at least one/i);
  });

  it("returns a yaml_read_error failure for a missing file", async () => {
    const result = await loadManifest(
      "tests/fixtures/manifests/does-not-exist.yml",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("yaml_read_error");
  });

  it("defaults missing scope to project when parsing manifest input", () => {
    const parsed = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["frontend/skills/react-useeffect"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.scope).toBe("project");
  });

  it("rejects missing source with a clear error message", () => {
    const issues = validateManifest({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["frontend/skills/react-useeffect"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("source");
    expect(issues[0].message).toBe(
      "source is required; add a source block with type, repo, and ref",
    );
  });

  it("accepts a home-scoped valid manifest fixture", async () => {
    const result = await loadManifest("tests/fixtures/manifests/valid.yml");
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const parsed = ManifestSchema.safeParse(result.value);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.scope).toBe("home");
  });

  it("rejects missing source before global checks (include: global)", () => {
    const issues = validateManifest({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["global"],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("source");
    expect(issues[0].message).toBe(
      "source is required; add a source block with type, repo, and ref",
    );
  });

  it("rejects missing source before global checks (include: global/skills)", () => {
    const issues = validateManifest({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["global/skills/writing-plans"],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("source");
    expect(issues[0].message).toBe(
      "source is required; add a source block with type, repo, and ref",
    );
  });

  it("rejects global includes in project scope even with source", () => {
    const issues = validateManifest({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["global/skills/writing-plans"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("");
    expect(issues[0].message).toContain('"global" domain is reserved');
  });

  it("allows global includes in home scope", () => {
    const issues = validateManifest({
      version: 1,
      scope: "home",
      mode: "generated",
      target: "both",
      include: ["global", "global/skills/writing-plans"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    });

    expect(issues).toEqual([]);
  });

  it("formats manifest-level issues as error lines", () => {
    expect(
      formatIssue({
        path: "",
        message:
          '"global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.',
      }),
    ).toBe(
      'error: "global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.',
    );
  });
});

describe("validateSkillSpecs", () => {
  it("rejects skills without YAML frontmatter", async () => {
    const root = "/tmp/agent-library-no-frontmatter-skill";
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    await Bun.write(`${root}/SKILL.md`, "# Missing frontmatter\n");

    try {
      const issues = await validateSkillSpecs([makeSkillArtifact(root)]);
      expect(issues[0].message).toMatch(/missing YAML frontmatter/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires the Agent Skills description field", async () => {
    const root = "/tmp/agent-library-missing-description-skill";
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    await Bun.write(`${root}/SKILL.md`, "---\nname: example\n---\n");

    try {
      const issues = await validateSkillSpecs([makeSkillArtifact(root)]);
      expect(issues[0].message).toMatch(/description/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function makeSkillArtifact(sourceRoot: string): Artifact {
  return createSkillArtifact({
    id: "test/skills/example",
    domain: "test",
    basename: "example",
    libraryRoot: "/tmp",
    rootDir: sourceRoot,
    primarySourceFile: `${sourceRoot}/SKILL.md`,
  });
}
