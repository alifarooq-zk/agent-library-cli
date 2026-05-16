import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cloneUrlFromRepo,
  bareRepoCachePath,
  treePath,
  fetchBareRepo,
  resolveRefSha,
  materializeTree,
  hasCachedSha,
} from "../../src/github/cache.ts";

const CACHE_DIR = mkdtempSync(join(tmpdir(), "al-cache-"));
let BARE_REPO: string;
let COMMIT_SHA: string;

beforeAll(async () => {
  const work = mkdtempSync(join(tmpdir(), "al-work-"));
  await Bun.$`git -C ${work} init --initial-branch main`.quiet();
  await Bun.$`git -C ${work} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${work} config user.name "Test"`.quiet();
  await Bun.write(join(work, "README.md"), "hello");
  await Bun.$`git -C ${work} add README.md`.quiet();
  await Bun.$`git -C ${work} commit -m "init"`.quiet();
  COMMIT_SHA = (await Bun.$`git -C ${work} rev-parse HEAD`.text()).trim();
  BARE_REPO = `${work}-bare.git`;
  await Bun.$`git clone --bare ${work} ${BARE_REPO}`.quiet();
  rmSync(work, { recursive: true });
});

afterAll(() => {
  rmSync(CACHE_DIR, { recursive: true, force: true });
  rmSync(BARE_REPO, { recursive: true, force: true });
});

describe("cloneUrlFromRepo", () => {
  it("derives https github url from org/name", () => {
    expect(cloneUrlFromRepo("org/repo")).toBe(
      "https://github.com/org/repo.git",
    );
  });

  it("uses AGENT_LIBRARY_TEST_REPO_PATH override when set", () => {
    process.env.AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH = "/tmp/test.git";
    expect(cloneUrlFromRepo("org/repo")).toBe("/tmp/test.git");
    delete process.env.AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH;
  });
});

describe("bareRepoCachePath", () => {
  it("returns a deterministic path based on sha256 of url", () => {
    const p1 = bareRepoCachePath("https://github.com/org/repo.git", CACHE_DIR);
    const p2 = bareRepoCachePath("https://github.com/org/repo.git", CACHE_DIR);
    expect(p1).toBe(p2);
    expect(p1).toMatch(/\.git$/);
  });

  it("returns different paths for different urls", () => {
    const p1 = bareRepoCachePath("https://github.com/org/a.git", CACHE_DIR);
    const p2 = bareRepoCachePath("https://github.com/org/b.git", CACHE_DIR);
    expect(p1).not.toBe(p2);
  });
});

describe("fetchBareRepo", () => {
  it("clones a bare repo from a local path", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await fetchBareRepo(BARE_REPO, cachePath);
    expect(result.ok).toBe(true);
    const exists = await Bun.file(join(cachePath, "HEAD")).exists();
    expect(exists).toBe(true);
  });

  it("fetches into existing bare repo (no error)", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await fetchBareRepo(BARE_REPO, cachePath);
    expect(result.ok).toBe(true);
  });

  it("returns git_repo_not_found for a non-existent path", async () => {
    const result = await fetchBareRepo(
      "/nonexistent/repo.git",
      join(CACHE_DIR, "fail.git"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("git_repo_not_found");
  });
});

describe("resolveRefSha", () => {
  it("resolves main ref to commit sha", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await resolveRefSha(cachePath, "main");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(COMMIT_SHA);
  });

  it("returns git_ref_not_found for unknown ref", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await resolveRefSha(cachePath, "nonexistent-branch");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("git_ref_not_found");
  });
});

describe("materializeTree", () => {
  it("extracts tree for known sha", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const dest = treePath(COMMIT_SHA, CACHE_DIR);
    const result = await materializeTree(cachePath, COMMIT_SHA, dest);
    expect(result.ok).toBe(true);
    const readmeExists = await Bun.file(join(dest, "README.md")).exists();
    expect(readmeExists).toBe(true);
  });

  it("is idempotent: skips extraction if dest already exists", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const dest = treePath(COMMIT_SHA, CACHE_DIR);
    const result = await materializeTree(cachePath, COMMIT_SHA, dest);
    expect(result.ok).toBe(true);
  });
});

describe("hasCachedSha", () => {
  it("returns true for a sha present in the bare repo", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await hasCachedSha(cachePath, COMMIT_SHA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(true);
  });

  it("returns false for an unknown sha", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await hasCachedSha(cachePath, "a".repeat(40));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(false);
  });
});
