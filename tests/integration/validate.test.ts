import { describe, it, expect } from "bun:test";

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args]);
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

describe("validate command", () => {
  it("exits 0 for a valid manifest", () => {
    const r = run(["validate", "tests/fixtures/projects/validate-valid"]);
    expect(r.code).toBe(0);
  });

  it("exits 1 and names the missing version field", () => {
    const r = run([
      "validate",
      "tests/fixtures/projects/validate-missing-version",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/version/);
  });
});
