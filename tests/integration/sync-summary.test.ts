import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "node:path";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const HOME = resolve("tests/fixtures/home-min");
const FIXTURE_PROJECT = resolve("tests/fixtures/projects/p2-mixed");
const TEMP_PROJECT = join("/tmp", "al-test-summary-project");

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

describe("sync summary", () => {
  beforeEach(resetProject);
  afterEach(() => {
    rmSync(TEMP_PROJECT, { recursive: true, force: true });
  });

  it("matches the spec format line-for-line", () => {
    const r = run(["sync", TEMP_PROJECT]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      [
        "Agent library sync complete",
        `Root: ${TEMP_PROJECT}`,
        "Mode: generated",
        "Target: both",
        "Skills: 1",
        "Commands: 1",
        "Agents: 1",
        "Removed stale generated files: 0",
        "Lockfile: .agent-library.lock",
        "",
      ].join("\n"),
    );
  });
});
