import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { rmSync } from "node:fs";

const HOME = resolve("tests/fixtures/home-min");
const PROJECT = resolve("tests/fixtures/projects/p4-adapters");

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: { ...process.env, HOME_AGENT_LIBRARY: HOME },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

function cleanTargets() {
  for (const dir of [".agents", ".claude"]) {
    rmSync(join(PROJECT, dir), { recursive: true, force: true });
  }
  rmSync(join(PROJECT, ".agent-library.lock"), { force: true });
}

describe("sync generated with adapters", () => {
  beforeEach(cleanTargets);
  afterEach(cleanTargets);

  it("exits 0", () => {
    const r = run(["sync", PROJECT]);
    expect(r.code).toBe(0);
  });

  it(".claude skill SKILL.md contains Claude-specific adapter content", async () => {
    run(["sync", PROJECT]);
    const content = await Bun.file(
      join(PROJECT, ".claude", "skills", "react-useeffect", "SKILL.md"),
    ).text();
    expect(content).toContain("Claude-specific note");
  });

  it(".agents skill SKILL.md contains Codex-specific adapter content", async () => {
    run(["sync", PROJECT]);
    const content = await Bun.file(
      join(PROJECT, ".agents", "skills", "react-useeffect", "SKILL.md"),
    ).text();
    expect(content).toContain("Codex-specific note");
  });

  it(".agents skill SKILL.md does NOT contain Claude-specific content", async () => {
    run(["sync", PROJECT]);
    const content = await Bun.file(
      join(PROJECT, ".agents", "skills", "react-useeffect", "SKILL.md"),
    ).text();
    expect(content).not.toContain("Claude-specific note");
  });

  it(".claude agent security-reviewer.md contains Claude variant adapter content", async () => {
    run(["sync", PROJECT]);
    const content = await Bun.file(
      join(PROJECT, ".claude", "agents", "security-reviewer.md"),
    ).text();
    expect(content).toContain("Claude variant");
  });

  it(".agents agent security-reviewer.md does NOT contain Claude variant (no codex adapter)", async () => {
    run(["sync", PROJECT]);
    const content = await Bun.file(
      join(PROJECT, ".agents", "agents", "security-reviewer.md"),
    ).text();
    expect(content).not.toContain("Claude variant");
  });
});
