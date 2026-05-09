import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";
import { classifyArtifact } from "../../src/artifact/discover.ts";

const HOME = resolve("tests/fixtures/home-min");

describe("classifyArtifact", () => {
  it("builds a skill artifact with a directory root and primary source file", () => {
    const artifact = classifyArtifact(
      HOME,
      "frontend",
      "skills",
      "react-useeffect",
    );

    expect(artifact?.kind).toBe("skill");
    if (!artifact || artifact.kind !== "skill") return;
    expect(String(artifact.id)).toBe("frontend/skills/react-useeffect");
    expect(String(artifact.rootDir)).toBe(
      resolve(HOME, "frontend/skills/react-useeffect"),
    );
    expect(String(artifact.primarySourceFile)).toBe(
      resolve(HOME, "frontend/skills/react-useeffect/SKILL.md"),
    );
  });

  it("builds a command artifact with a markdown source file", () => {
    const artifact = classifyArtifact(HOME, "global", "commands", "review-pr");

    expect(artifact?.kind).toBe("command");
    if (!artifact || artifact.kind !== "command") return;
    expect(String(artifact.id)).toBe("global/commands/review-pr");
    expect(String(artifact.sourceFile)).toBe(
      resolve(HOME, "global/commands/review-pr.md"),
    );
  });
});
