import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readLockfile } from "../../src/lockfile/read.ts";
import { hashFile } from "../../src/lockfile/hash.ts";
import { LockfileSchema, type Lockfile } from "../../src/lockfile/schema.ts";

const HOME = resolve("tests/fixtures/home-min");
const FIXTURE = resolve("tests/fixtures/projects/p2-mixed");

// Mutable — assigned fresh in beforeEach so parallel file-level runs don't share state.
let PROJECT: string;

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

async function readProjectLockfile(): Promise<Lockfile> {
  const result = await readLockfile(join(PROJECT, ".agent-library.lock"));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value).not.toBeNull();
  if (result.value === null) throw new Error("Expected lockfile to exist");
  return result.value;
}

describe("sync lockfile", () => {
  beforeEach(() => {
    PROJECT = mkdtempSync(join(tmpdir(), "al-test-lockfile-"));
    cpSync(FIXTURE, PROJECT, { recursive: true });
  });
  afterEach(() => {
    rmSync(PROJECT, { recursive: true, force: true });
  });

  it("writes a valid lockfile after sync", async () => {
    const r = run(["sync", PROJECT]);
    expect(r.code).toBe(0);

    const lockfile = await readProjectLockfile();

    // Must parse through the schema without errors
    const parsed = LockfileSchema.safeParse(lockfile);
    expect(parsed.success).toBe(true);
  });

  it("lockfile has correct cliVersion and artifact count", async () => {
    run(["sync", PROJECT]);

    const lockfile = await readProjectLockfile();
    expect(lockfile.version).toBe(2);
    expect(lockfile.cliVersion).toBe("0.1.0");
    expect(lockfile.artifacts.length).toBe(3);
  });

  it("lockfile sourceHash matches actual file content", async () => {
    run(["sync", PROJECT]);

    const lockfile = await readProjectLockfile();

    for (const artifact of lockfile.artifacts) {
      for (const file of artifact.files) {
        const absSource = join(HOME, file.source);
        const computedHash = await hashFile(absSource);
        expect(file.sourceHash).toBe(computedHash);
      }
    }
  });

  it("lockfile records correct mode, target, and include", async () => {
    run(["sync", PROJECT]);

    const lockfile = await readProjectLockfile();
    expect(lockfile.mode).toBe("generated");
    expect(lockfile.target).toBe("both");
    expect(lockfile.include).toEqual([
      "global/skills/writing-plans",
      "global/commands/review-pr",
      "global/agents/security-reviewer",
    ]);
  });

  it("lockfile syncedAt is a valid ISO 8601 date string", async () => {
    run(["sync", PROJECT]);

    const lockfile = await readProjectLockfile();
    expect(new Date(lockfile.syncedAt).toISOString()).toBe(lockfile.syncedAt);
  });

  it("lockfile uses discriminated adapter entries", async () => {
    run(["sync", PROJECT]);

    const lockfile = await readProjectLockfile();
    for (const artifact of lockfile.artifacts) {
      for (const file of artifact.files) {
        for (const target of file.targets) {
          expect(["none", "applied"]).toContain(target.adapter.kind);
        }
      }
    }
  });
});
