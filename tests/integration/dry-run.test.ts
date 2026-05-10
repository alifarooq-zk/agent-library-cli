import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "node:path";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const HOME = resolve("tests/fixtures/home-min");
const FIXTURE_PROJECT = resolve("tests/fixtures/projects/p2-mixed");
const TEMP_PROJECT = join("/tmp", "al-test-dry-run-project");

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

function resetProject() {
  rmSync(TEMP_PROJECT, { recursive: true, force: true });
  mkdirSync(TEMP_PROJECT, { recursive: true });
  cpSync(
    join(FIXTURE_PROJECT, ".agent-library.yml"),
    join(TEMP_PROJECT, ".agent-library.yml"),
  );
}

describe("sync --dry-run", () => {
  beforeEach(resetProject);
  afterEach(() => {
    rmSync(TEMP_PROJECT, { recursive: true, force: true });
  });

  it("prints prospective writes without touching disk", async () => {
    const r = run(["sync", "--dry-run", TEMP_PROJECT]);
    expect(r.code).toBe(0);

    const dryRunLines = r.stdout
      .split("\n")
      .filter((line) => line.startsWith("[dry-run] would write "));
    expect(dryRunLines).toHaveLength(8); // 3 artifacts × 2 targets + 2 bundled template.md
    expect(dryRunLines).toContain(
      "[dry-run] would write .agents/skills/writing-plans/SKILL.md",
    );
    expect(dryRunLines).toContain(
      "[dry-run] would write .agents/skills/writing-plans/template.md",
    );
    expect(dryRunLines).toContain(
      "[dry-run] would write .claude/skills/writing-plans/template.md",
    );
    expect(dryRunLines).toContain(
      "[dry-run] would write .claude/agents/security-reviewer.md",
    );

    expect(await Bun.file(join(TEMP_PROJECT, ".agents")).exists()).toBe(false);
    expect(await Bun.file(join(TEMP_PROJECT, ".claude")).exists()).toBe(false);
    expect(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.lock")).exists(),
    ).toBe(false);
  });

  it("prints stale removals without deleting generated files", async () => {
    const first = run(["sync", TEMP_PROJECT]);
    expect(first.code).toBe(0);

    await Bun.write(
      join(TEMP_PROJECT, ".agent-library.yml"),
      [
        "version: 1",
        "scope: home",
        "mode: generated",
        "target: both",
        "include:",
        "  - global/skills/writing-plans",
        "",
      ].join("\n"),
    );

    const staleCommand = join(
      TEMP_PROJECT,
      ".agents",
      "commands",
      "review-pr.md",
    );
    const staleAgent = join(
      TEMP_PROJECT,
      ".claude",
      "agents",
      "security-reviewer.md",
    );
    expect(await Bun.file(staleCommand).exists()).toBe(true);
    expect(await Bun.file(staleAgent).exists()).toBe(true);

    const dryRun = run(["sync", "--dry-run", TEMP_PROJECT]);
    expect(dryRun.code).toBe(0);
    expect(dryRun.stdout).toContain(
      "[dry-run] would remove .agents/commands/review-pr.md",
    );
    expect(dryRun.stdout).toContain(
      "[dry-run] would remove .claude/agents/security-reviewer.md",
    );
    expect(await Bun.file(staleCommand).exists()).toBe(true);
    expect(await Bun.file(staleAgent).exists()).toBe(true);
  });
});
