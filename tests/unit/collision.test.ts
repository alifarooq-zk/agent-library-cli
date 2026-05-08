import { describe, it, expect } from "bun:test";
import { detectCollisions } from "../../src/artifact/collision.ts";

describe("detectCollisions", () => {
  it("returns empty array when no collisions", () => {
    const issues = detectCollisions([
      {
        artifactId: "global/skills/writing-plans",
        targetPath: ".claude/skills/writing-plans/SKILL.md",
      },
      {
        artifactId: "global/commands/review-pr",
        targetPath: ".claude/commands/review-pr.md",
      },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("flags duplicate target paths and names both sources", () => {
    const issues = detectCollisions([
      {
        artifactId: "security/skills/review",
        targetPath: ".claude/skills/review/SKILL.md",
      },
      {
        artifactId: "testing/skills/review",
        targetPath: ".claude/skills/review/SKILL.md",
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("security/skills/review");
    expect(issues[0].message).toContain("testing/skills/review");
    expect(issues[0].message).toContain(".claude/skills/review/SKILL.md");
  });

  it("flags multiple independent collisions separately", () => {
    const issues = detectCollisions([
      { artifactId: "a/skills/foo", targetPath: ".claude/skills/foo/SKILL.md" },
      { artifactId: "b/skills/foo", targetPath: ".claude/skills/foo/SKILL.md" },
      {
        artifactId: "a/commands/bar",
        targetPath: ".claude/commands/bar.md",
      },
      {
        artifactId: "b/commands/bar",
        targetPath: ".claude/commands/bar.md",
      },
    ]);
    expect(issues).toHaveLength(2);
  });
});
