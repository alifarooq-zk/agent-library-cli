import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { rmSync } from "node:fs";
import { readLockfile } from "../../src/lockfile/read.ts";

const HOME = resolve("tests/fixtures/home-min");
const PROJECT = resolve("tests/fixtures/projects/p7-bundle");

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
  rmSync(join(PROJECT, ".claude"), { recursive: true, force: true });
  rmSync(join(PROJECT, ".agent-library.lock"), { force: true });
}

describe("sync bundle expansion lockfile", () => {
  beforeEach(cleanTargets);
  afterEach(cleanTargets);

  it("records original bundle includes and expanded artifact ids", async () => {
    const r = run(["sync", PROJECT]);
    expect(r.code).toBe(0);

    const lockfileResult = await readLockfile(join(PROJECT, ".agent-library.lock"));
    expect(lockfileResult.ok).toBe(true);
    if (!lockfileResult.ok) return;
    expect(lockfileResult.value).not.toBeNull();
    if (lockfileResult.value === null) return;
    expect(lockfileResult.value.include).toEqual(["global"]);
    expect(lockfileResult.value.artifacts.map((a) => a.id).sort()).toEqual([
      "global/agents/security-reviewer",
      "global/commands/review-pr",
      "global/skills/writing-plans",
    ]);
  });
});
