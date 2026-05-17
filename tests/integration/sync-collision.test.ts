import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { existsSync, rmSync } from "node:fs"; // existsSync used for directory checks (Bun.file cannot check dirs)

const HOME = resolve("tests/fixtures/home-min");
const PROJECT = resolve("tests/fixtures/projects/p3-collision");

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["bun", "run", "src/cli.ts", ...args], {
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
}

describe("sync collision detection", () => {
  beforeEach(cleanTargets);
  afterEach(cleanTargets);

  it("exits 1 and names both source artifact ids and the conflicting target path", () => {
    const r = run(["sync", "--home", HOME, PROJECT]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("security/skills/review");
    expect(r.stderr).toContain("testing/skills/review");
    expect(r.stderr.replace(/\\/g, "/")).toMatch(/skills\/review\/SKILL\.md/);
  });

  it("does not write any target files when a collision is detected", () => {
    run(["sync", "--home", HOME, PROJECT]);
    expect(existsSync(join(PROJECT, ".claude"))).toBe(false);
    expect(existsSync(join(PROJECT, ".agents"))).toBe(false);
  });
});
