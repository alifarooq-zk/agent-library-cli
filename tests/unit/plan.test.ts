import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";
import { expandBundle } from "../../src/resolve/bundles.ts";
import { buildPlan } from "../../src/sync/plan.ts";
import {
  writeAdapterSource,
  writeArtifactId,
  writeArtifactKind,
  writeTargetRelative,
} from "../../src/sync/plan.ts";
import type { Manifest } from "../../src/manifest/schema.ts";

const HOME = resolve("tests/fixtures/home-min");
const PROJECT = resolve("tests/fixtures/projects/p4-adapters");

async function artifactsFor(idPath: string) {
  const result = expandBundle(HOME, idPath);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("buildPlan", () => {
  it("plans skills, commands, agents, dual targets, and adapters", async () => {
    const manifest: Manifest = {
      version: 1,
      scope: "home",
      mode: "generated",
      target: "both",
      include: ["global", "frontend/skills/react-useeffect"],
    };
    const artifacts = [
      ...(await artifactsFor("global")),
      ...(await artifactsFor("frontend/skills/react-useeffect")),
    ];

    const plan = buildPlan(manifest, artifacts, PROJECT);
    const writes = plan.writes.map((write) => ({
      id: writeArtifactId(write),
      kind: writeArtifactKind(write),
      target: String(writeTargetRelative(write)),
      adapter:
        writeAdapterSource(write) === null
          ? null
          : String(writeAdapterSource(write)),
      contentKind: write.source.contentKind,
    }));

    expect(writes).toContainEqual({
      id: "global/skills/writing-plans",
      kind: "skill",
      target: ".agents/skills/writing-plans/SKILL.md",
      adapter: null,
      contentKind: "markdown",
    });
    expect(writes).toContainEqual({
      id: "global/commands/review-pr",
      kind: "command",
      target: ".claude/commands/review-pr.md",
      adapter: null,
      contentKind: "markdown",
    });
    expect(writes).toContainEqual({
      id: "global/agents/security-reviewer",
      kind: "agent",
      target: ".claude/agents/security-reviewer.md",
      adapter: resolve(
        HOME,
        "global/agents/security-reviewer.adapters/claude.md",
      ),
      contentKind: "markdown",
    });
    expect(writes).toContainEqual({
      id: "frontend/skills/react-useeffect",
      kind: "skill",
      target: ".agents/skills/react-useeffect/SKILL.md",
      adapter: resolve(
        HOME,
        "frontend/skills/react-useeffect/adapters/codex.md",
      ),
      contentKind: "markdown",
    });
  });
});
