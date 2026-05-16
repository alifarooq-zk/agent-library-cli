import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import { readLockfile } from "../../src/lockfile/read.ts";
import {
  createTestBareRepo,
  type TestBareRepo,
} from "../helpers/test-bare-repo.ts";

const FIXTURE = resolve("tests/fixtures/projects/p1-skill-only");
let repo: TestBareRepo;
let cacheDir: string;
let projectDir: string;

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: {
      ...process.env,
      AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH: repo.bareRepoPath,
      AGENT_LIBRARY_CACHE_DIR: cacheDir,
    },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

beforeAll(async () => {
  repo = await createTestBareRepo("tests/fixtures/home-min");
});

afterAll(() => {
  repo.cleanup();
});

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "al-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "al-sync-github-"));
  cpSync(FIXTURE, projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, ".agent-library.yml"),
    stringify({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/writing-plans"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    }),
  );
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("sync with github source", () => {
  it("first-time sync succeeds and writes lockfile with source block", async () => {
    const result = run(["sync", projectDir]);
    expect(result.code).toBe(0);

    const lockResult = await readLockfile(
      join(projectDir, ".agent-library.lock"),
    );
    expect(lockResult.ok).toBe(true);
    if (!lockResult.ok || !lockResult.value) return;

    expect(lockResult.value.version).toBe(1);
    expect(lockResult.value.source).toBeDefined();
    expect(lockResult.value.source?.sha).toBe(repo.commitSha);
    expect(lockResult.value.source?.repo).toBe("org/repo");
  });

  it("re-sync with pinned SHA succeeds", () => {
    run(["sync", projectDir]);
    const result = run(["sync", projectDir]);
    expect(result.code).toBe(0);
  });

  it("sync with missing cached SHA fails with actionable error", () => {
    const fakeSha = "b".repeat(40);
    writeFileSync(
      join(projectDir, ".agent-library.lock"),
      stringify({
        version: 1,
        cliVersion: "0.1.0",
        mode: "generated",
        target: "claude",
        syncedAt: new Date().toISOString(),
        source: {
          repo: "org/repo",
          sha: fakeSha,
          ref: "main",
          fetchedAt: new Date().toISOString(),
        },
        include: ["global/skills/writing-plans"],
        artifacts: [],
      }),
    );

    const result = run(["sync", projectDir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(fakeSha);
    expect(result.stderr).toContain("sync --update");
  });

  it("sync --update fetches latest SHA and updates lockfile", async () => {
    run(["sync", projectDir]);
    const result = run(["sync", "--update", projectDir]);
    expect(result.code).toBe(0);

    const lockResult = await readLockfile(
      join(projectDir, ".agent-library.lock"),
    );
    expect(lockResult.ok).toBe(true);
    if (!lockResult.ok || !lockResult.value) return;
    expect(lockResult.value.source?.sha).toBe(repo.commitSha);
  });
});
