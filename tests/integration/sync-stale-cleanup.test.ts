import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync } from "node:fs";
import { stringify } from "yaml";

const HOME = resolve("tests/fixtures/home-min");
// Use a temporary copy so we can modify the manifest between runs
const TEMP_PROJECT = join("/tmp", "al-test-stale-cleanup");

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

function setManifestIncludes(includes: string[]) {
  const manifest = {
    version: 1,
    mode: "generated",
    target: "both",
    include: includes,
  };
  writeFileSync(
    join(TEMP_PROJECT, ".agent-library.yml"),
    stringify(manifest),
    "utf8",
  );
}

describe("sync stale file cleanup", () => {
  beforeEach(() => {
    // Create a fresh temp project copy from p2-mixed
    rmSync(TEMP_PROJECT, { recursive: true, force: true });
    mkdirSync(TEMP_PROJECT, { recursive: true });
    cpSync(
      resolve("tests/fixtures/projects/p2-mixed/.agent-library.yml"),
      join(TEMP_PROJECT, ".agent-library.yml"),
    );
  });

  afterEach(() => {
    rmSync(TEMP_PROJECT, { recursive: true, force: true });
  });

  it("removes stale files from prior sync after manifest shrinks", async () => {
    // Step 1: Sync with 3 artifacts (6 files across both targets)
    const r1 = run(["sync", TEMP_PROJECT]);
    expect(r1.code).toBe(0);

    // Confirm all 6 files exist
    const expectedFiles = [
      join(TEMP_PROJECT, ".agents", "skills", "writing-plans", "SKILL.md"),
      join(TEMP_PROJECT, ".claude", "skills", "writing-plans", "SKILL.md"),
      join(TEMP_PROJECT, ".agents", "commands", "review-pr.md"),
      join(TEMP_PROJECT, ".claude", "commands", "review-pr.md"),
      join(TEMP_PROJECT, ".agents", "agents", "security-reviewer.md"),
      join(TEMP_PROJECT, ".claude", "agents", "security-reviewer.md"),
    ];
    for (const f of expectedFiles) {
      expect(existsSync(f)).toBe(true);
    }

    // Step 2: Rewrite manifest to only include writing-plans
    setManifestIncludes(["global/skills/writing-plans"]);

    // Step 3: Sync again
    const r2 = run(["sync", TEMP_PROJECT]);
    expect(r2.code).toBe(0);

    // Step 4: stdout must report 4 removed stale files
    expect(r2.stdout).toContain("Removed stale generated files: 4");

    // Step 5: command and agent target files must be gone
    expect(
      existsSync(join(TEMP_PROJECT, ".agents", "commands", "review-pr.md")),
    ).toBe(false);
    expect(
      existsSync(join(TEMP_PROJECT, ".claude", "commands", "review-pr.md")),
    ).toBe(false);
    expect(
      existsSync(
        join(TEMP_PROJECT, ".agents", "agents", "security-reviewer.md"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(TEMP_PROJECT, ".claude", "agents", "security-reviewer.md"),
      ),
    ).toBe(false);

    // Step 6: skill files must still exist
    expect(
      existsSync(
        join(TEMP_PROJECT, ".agents", "skills", "writing-plans", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(TEMP_PROJECT, ".claude", "skills", "writing-plans", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("removes stale generated skills whose marker follows frontmatter", async () => {
    const r1 = run(["sync", TEMP_PROJECT]);
    expect(r1.code).toBe(0);

    setManifestIncludes([
      "global/commands/review-pr",
      "global/agents/security-reviewer",
    ]);

    const r2 = run(["sync", TEMP_PROJECT]);
    expect(r2.code).toBe(0);
    // writing-plans has 2 source files (SKILL.md + template.md) × 2 targets = 4 stale
    expect(r2.stdout).toContain("Removed stale generated files: 4");

    expect(
      existsSync(
        join(TEMP_PROJECT, ".agents", "skills", "writing-plans", "SKILL.md"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(TEMP_PROJECT, ".claude", "skills", "writing-plans", "SKILL.md"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(TEMP_PROJECT, ".agents", "skills", "writing-plans", "template.md"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(TEMP_PROJECT, ".claude", "skills", "writing-plans", "template.md"),
      ),
    ).toBe(false);
  });

  it("does not remove unmarked files that lack the generated marker", async () => {
    // Sync with only writing-plans
    setManifestIncludes(["global/skills/writing-plans"]);
    run(["sync", TEMP_PROJECT]);

    // Manually create an unmarked file inside the skill target directory
    const unmarkedPath = join(
      TEMP_PROJECT,
      ".claude",
      "skills",
      "writing-plans",
      "notes.md",
    );
    writeFileSync(
      unmarkedPath,
      "# My local notes\nThis is not generated.",
      "utf8",
    );

    // Sync again with the same manifest — the unmarked file should survive
    const r = run(["sync", TEMP_PROJECT]);
    expect(r.code).toBe(0);
    expect(existsSync(unmarkedPath)).toBe(true);
  });

  it("does not remove a stale unmarked file whose body contains the generated marker phrase", async () => {
    // Step 1: Sync with mixed artifacts so the command file is tracked in the lockfile.
    const r1 = run(["sync", TEMP_PROJECT]);
    expect(r1.code).toBe(0);

    const staleButLocalPath = join(
      TEMP_PROJECT,
      ".agents",
      "commands",
      "review-pr.md",
    );
    writeFileSync(
      staleButLocalPath,
      [
        "# Local review notes",
        "",
        "This body mentions Generated by agent-library. but has no ownership header.",
      ].join("\n"),
      "utf8",
    );

    // Step 2: Shrink the manifest so the tracked command file becomes stale.
    setManifestIncludes(["global/skills/writing-plans"]);

    const r2 = run(["sync", TEMP_PROJECT]);
    expect(r2.code).toBe(0);
    expect(existsSync(staleButLocalPath)).toBe(true);
  });
});
