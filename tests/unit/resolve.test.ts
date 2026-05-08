import { describe, it, expect } from "bun:test";
import { resolveIncludes } from "../../src/resolve/sources.ts";
import { resolve } from "node:path";

const HOME = resolve("tests/fixtures/home-min");

describe("resolveIncludes", () => {
  it("resolves a concrete skill path", async () => {
    const result = await resolveIncludes(["frontend/skills/react-useeffect"], {
      homeRoot: HOME,
      projectRoot: null,
    });
    if (!result.ok)
      throw new Error(`Expected success: ${result.error.message}`);
    expect(result.value.map((a) => a.id)).toEqual([
      "frontend/skills/react-useeffect",
    ]);
    expect(result.value[0].kind).toBe("skill");
  });

  it("expands a bundle directory into its artifacts", async () => {
    const result = await resolveIncludes(["global"], {
      homeRoot: HOME,
      projectRoot: null,
    });
    if (!result.ok)
      throw new Error(`Expected success: ${result.error.message}`);
    const ids = result.value.map((a) => a.id).sort();
    expect(ids).toEqual([
      "global/agents/security-reviewer",
      "global/commands/review-pr",
      "global/skills/writing-plans",
    ]);
  });

  it("expands a profile reference", async () => {
    const result = await resolveIncludes(["profile:frontend"], {
      homeRoot: HOME,
      projectRoot: null,
    });
    if (!result.ok)
      throw new Error(`Expected success: ${result.error.message}`);
    const ids = result.value.map((a) => a.id);
    expect(ids).toContain("frontend/skills/react-useeffect");
    expect(ids).toContain("frontend/skills/shadcn");
    expect(ids).toContain("global/skills/writing-plans");
  });

  it("returns profile_nested failure for a profile that includes another profile", async () => {
    const result = await resolveIncludes(["profile:nested"], {
      homeRoot: HOME,
      projectRoot: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("profile_nested");
    expect(result.error.message).toMatch(/profile.*may not include.*profile/i);
  });

  it("returns bundle_not_found failure for an unresolvable include", async () => {
    const result = await resolveIncludes(["frontend/skills/does-not-exist"], {
      homeRoot: HOME,
      projectRoot: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("bundle_not_found");
    expect(result.error.message).toMatch(/cannot resolve/i);
  });

  it("requires project context for project-local includes", async () => {
    const result = await resolveIncludes(["./product/skills/domain-review"], {
      homeRoot: HOME,
      projectRoot: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("source_project_context_missing");
    expect(result.error.message).toMatch(/project root/i);
  });

  it("rejects project-local includes that escape the project .agent-library root", async () => {
    const result = await resolveIncludes(["./../home-min/global"], {
      homeRoot: HOME,
      projectRoot: resolve("tests/fixtures/projects/p6-local"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("bundle_path_too_deep");
    expect(result.error.message).toMatch(/must stay under/i);
  });
});
