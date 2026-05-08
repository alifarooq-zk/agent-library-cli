import { describe, it, expect } from "bun:test";

describe("cli smoke", () => {
  it("prints version matching package.json", () => {
    const result = Bun.spawnSync(["./bin/agent-library", "--version"]);
    expect(result.stdout.toString().trim()).toBe("0.1.0");
  });
});
