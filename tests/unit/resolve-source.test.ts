import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { resolveSource } from "../../src/resolve/source.ts";
import {
  createTestBareRepo,
  type TestBareRepo,
} from "../helpers/test-bare-repo.ts";

const HOME = "tests/fixtures/home-min";
let repo: TestBareRepo;
let cacheDir: string;
let projectDir: string;

beforeAll(async () => {
  repo = await createTestBareRepo(HOME);
  process.env.AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH = repo.bareRepoPath;
});

afterAll(() => {
  repo.cleanup();
  delete process.env.AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH;
});

beforeEach(() => {
  process.env.AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH = repo.bareRepoPath;
  cacheDir = mkdtempSync(join(tmpdir(), "al-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "al-project-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

const manifestSource = {
  type: "github" as const,
  repo: "org/repo",
  ref: "main",
};

function lockfilePath(): string {
  return join(projectDir, ".agent-library.lock");
}

function writeLockfile(sha: string): void {
  writeFileSync(
    lockfilePath(),
    stringify({
      version: 1,
      cliVersion: "0.1.0",
      mode: "generated",
      target: "claude",
      syncedAt: new Date().toISOString(),
      source: {
        repo: "org/repo",
        sha,
        ref: "main",
        fetchedAt: new Date().toISOString(),
      },
      include: ["global/skills/writing-plans"],
      artifacts: [],
    }),
  );
}

describe("resolveSource: no lockfile (first-time sync)", () => {
  it("fetches bare repo, materializes tree, returns homeRoot", async () => {
    const result = await resolveSource(
      manifestSource,
      lockfilePath(),
      { update: false },
      cacheDir,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.homeRoot).toContain("trees");
      expect(result.value.source.sha).toBe(repo.commitSha);
      expect(result.value.source.repo).toBe("org/repo");
      expect(result.value.source.ref).toBe("main");
    }
  });
});

describe("resolveSource: lockfile present, SHA in cache", () => {
  it("returns tree path without fetching", async () => {
    const first = await resolveSource(
      manifestSource,
      lockfilePath(),
      { update: false },
      cacheDir,
    );
    expect(first.ok).toBe(true);

    writeLockfile(repo.commitSha);

    const second = await resolveSource(
      manifestSource,
      lockfilePath(),
      { update: false },
      cacheDir,
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.source.sha).toBe(repo.commitSha);
  });
});

describe("resolveSource: lockfile present, SHA NOT in cache (cache miss)", () => {
  it("returns git_sha_not_cached error", async () => {
    const fakeSha = "a".repeat(40);
    writeLockfile(fakeSha);

    const result = await resolveSource(
      manifestSource,
      lockfilePath(),
      { update: false },
      cacheDir,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("git_sha_not_cached");
      expect(result.error.message).toContain(fakeSha);
      expect(result.error.message).toContain("sync --update");
      expect(result.error.message).toContain("fetch from remote");
    }
  });
});

describe("resolveSource: corrupt lockfile", () => {
  it("propagates the lockfile read error", async () => {
    writeFileSync(lockfilePath(), "version: !!invalid\n");

    const result = await resolveSource(
      manifestSource,
      lockfilePath(),
      { update: false },
      cacheDir,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("lockfile_schema_error");
  });
});

describe("resolveSource: update mode", () => {
  it("fetches and resolves latest SHA regardless of lockfile", async () => {
    writeLockfile("a".repeat(40));

    const result = await resolveSource(
      manifestSource,
      lockfilePath(),
      { update: true },
      cacheDir,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.source.sha).toBe(repo.commitSha);
  });
});
