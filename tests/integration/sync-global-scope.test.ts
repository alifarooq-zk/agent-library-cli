import { describe, it, expect } from "bun:test";

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: {
      ...process.env,
      HOME_AGENT_LIBRARY: "tests/fixtures/home-min",
      NO_COLOR: "1",
    },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

describe("sync global scope restriction", () => {
  it("exits 1 before writing when a project manifest includes global directly", () => {
    const r = run(["sync", "tests/fixtures/projects/validate-project-global"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      'error: "global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.',
    );
  });

  it("exits 1 before writing when a project profile resolves global artifacts", () => {
    const r = run([
      "sync",
      "tests/fixtures/projects/validate-project-global-profile",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      'error: "global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.',
    );
  });
});
