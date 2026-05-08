import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdirSync, rmSync, cpSync, appendFileSync } from "node:fs";
import { readLockfile } from "../../src/lockfile/read.ts";
import { hashFile } from "../../src/lockfile/hash.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";

const FIXTURE_HOME = resolve("tests/fixtures/home-min");
const FIXTURE_PROJECT = resolve("tests/fixtures/projects/p5-vendored");
const TEMP_HOME = join("/tmp", "al-test-vendored-home");
const TEMP_PROJECT = join("/tmp", "al-test-vendored-project");

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: { ...process.env, HOME_AGENT_LIBRARY: TEMP_HOME },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

function resetFixtures() {
  rmSync(TEMP_HOME, { recursive: true, force: true });
  rmSync(TEMP_PROJECT, { recursive: true, force: true });
  mkdirSync(TEMP_HOME, { recursive: true });
  mkdirSync(TEMP_PROJECT, { recursive: true });
  cpSync(FIXTURE_HOME, TEMP_HOME, { recursive: true });
  cpSync(
    join(FIXTURE_PROJECT, ".agent-library.yml"),
    join(TEMP_PROJECT, ".agent-library.yml"),
  );
}

function targetPath(): string {
  return join(
    TEMP_PROJECT,
    ".claude",
    "skills",
    "react-useeffect",
    "SKILL.md",
  );
}

function sourcePath(): string {
  return join(TEMP_HOME, "frontend", "skills", "react-useeffect", "SKILL.md");
}

function lockfilePath(): string {
  return join(TEMP_PROJECT, ".agent-library.lock");
}

async function readProjectLockfile(): Promise<Lockfile> {
  const result = await readLockfile(lockfilePath());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value).not.toBeNull();
  if (result.value === null) throw new Error("Expected lockfile to exist");
  return result.value;
}

async function targetHashFromLockfile(): Promise<string> {
  const lockfile = await readProjectLockfile();
  const target = lockfile.artifacts[0].files[0].targets[0];
  return target.targetHash;
}

describe("sync vendored", () => {
  beforeEach(resetFixtures);
  afterEach(() => {
    rmSync(TEMP_HOME, { recursive: true, force: true });
    rmSync(TEMP_PROJECT, { recursive: true, force: true });
  });

  it("writes, updates only clean targets, and protects local edits", async () => {
    const first = run(["sync", TEMP_PROJECT]);
    expect(first.code).toBe(0);

    const target = targetPath();
    expect(await Bun.file(target).exists()).toBe(true);
    const firstContent = await Bun.file(target).text();
    expect(firstContent).toContain("Vendored from agent-library.");
    expect(firstContent).toContain("Source: frontend/skills/react-useeffect");
    expect(firstContent).toContain("Mode: vendored");
    await readProjectLockfile();
    expect(await targetHashFromLockfile()).toBe(await hashFile(target));

    const second = run(["sync", TEMP_PROJECT]);
    expect(second.code).toBe(0);
    expect(await Bun.file(target).text()).toBe(firstContent);
    expect(second.stdout).toContain("Vendored files skipped (locally edited): 0");

    const originalSource = await Bun.file(sourcePath()).text();
    await Bun.write(
      sourcePath(),
      `${originalSource}\n\nUpstream vendored update.\n`,
    );
    const hashBeforeSourceChangeSync = await targetHashFromLockfile();
    const third = run(["sync", TEMP_PROJECT]);
    expect(third.code).toBe(0);
    const updatedContent = await Bun.file(target).text();
    expect(updatedContent).toContain("Upstream vendored update.");
    expect(await targetHashFromLockfile()).not.toBe(hashBeforeSourceChangeSync);
    expect(await targetHashFromLockfile()).toBe(await hashFile(target));

    appendFileSync(target, "\nLOCAL EDIT\n", "utf8");
    await Bun.write(
      sourcePath(),
      `${originalSource}\n\nUpstream vendored update.\n\nSecond upstream update.\n`,
    );
    const fourth = run(["sync", TEMP_PROJECT]);
    expect(fourth.code).toBe(0);
    const locallyEditedContent = await Bun.file(target).text();
    expect(locallyEditedContent).toContain("LOCAL EDIT");
    expect(locallyEditedContent).not.toContain("Second upstream update.");
    expect(fourth.stderr).toContain("locally edited");
    expect(fourth.stderr).toContain("frontend/skills/react-useeffect");
    expect(fourth.stdout).toContain("Vendored files skipped (locally edited): 1");

    rmSync(lockfilePath(), { force: true });
    const contentBeforePreexistingSync = await Bun.file(target).text();
    const fifth = run(["sync", TEMP_PROJECT]);
    expect(fifth.code).toBe(0);
    expect(await Bun.file(target).text()).toBe(contentBeforePreexistingSync);
    expect(fifth.stderr).toContain(
      "pre-existing file, no lockfile to verify ownership",
    );
  });
});
