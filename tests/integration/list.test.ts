import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";

const HOME = resolve("tests/fixtures/home-min");

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

describe("list command", () => {
  it("list domains outputs global and frontend", () => {
    const r = run(["list", "domains"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("global");
    expect(r.stdout).toContain("frontend");
  });

  it("list profiles outputs universal and frontend", () => {
    const r = run(["list", "profiles"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("universal");
    expect(r.stdout).toContain("frontend");
  });

  it("list artifacts outputs all known artifacts", () => {
    const r = run(["list", "artifacts"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("frontend/skills/react-useeffect");
    expect(r.stdout).toContain("global/skills/writing-plans");
    expect(r.stdout).toContain("global/agents/security-reviewer");
    expect(r.stdout).toContain("global/commands/review-pr");
  });

  it("list artifacts --domain frontend only shows frontend artifacts", () => {
    const r = run(["list", "artifacts", "--domain", "frontend"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("frontend/skills/react-useeffect");
    expect(r.stdout).toContain("frontend/skills/shadcn");
    expect(r.stdout).not.toContain("global/skills/writing-plans");
  });

  it("list artifacts --type skill --domain global only shows global skills", () => {
    const r = run([
      "list",
      "artifacts",
      "--type",
      "skill",
      "--domain",
      "global",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("global/skills/writing-plans");
    expect(r.stdout).not.toContain("global/agents/security-reviewer");
  });
});
