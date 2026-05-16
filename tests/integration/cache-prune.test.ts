import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

let cacheDir: string;
let projectDir: string;

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: { ...process.env, AGENT_LIBRARY_CACHE_DIR: cacheDir },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "al-prune-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "al-prune-proj-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

function makeLockfile(projectPath: string, sha: string): void {
  writeFileSync(
    join(projectPath, ".agent-library.lock"),
    stringify({
      version: 1,
      cliVersion: "0.1.0",
      mode: "generated",
      target: "claude",
      syncedAt: "2026-05-11T00:00:00.000Z",
      source: {
        repo: "org/repo",
        sha,
        ref: "main",
        fetchedAt: "2026-05-11T00:00:00.000Z",
      },
      include: ["global/skills/foo"],
      artifacts: [],
    }),
  );
}

function makeTree(cacheRoot: string, sha: string): string {
  const treesDir = join(cacheRoot, "trees");
  mkdirSync(treesDir, { recursive: true });
  const treePath = join(treesDir, sha);
  mkdirSync(treePath);
  writeFileSync(join(treePath, "README.md"), "content");
  return treePath;
}

function makeRegistry(
  cacheRoot: string,
  projects: { path: string; sha: string }[],
): void {
  writeFileSync(
    join(cacheRoot, "projects.json"),
    JSON.stringify(
      {
        projects: projects.map((project) => ({
          path: project.path,
          repo: "org/repo",
          ref: "main",
          sha: project.sha,
          lastSyncedAt: "2026-05-11T00:00:00.000Z",
        })),
      },
      null,
      2,
    ),
  );
}

describe("cache prune", () => {
  it("removes trees not referenced by any active lockfile", () => {
    const activeSha = "a".repeat(40);
    const orphanSha = "b".repeat(40);

    makeTree(cacheDir, activeSha);
    const orphanPath = makeTree(cacheDir, orphanSha);
    makeLockfile(projectDir, activeSha);
    makeRegistry(cacheDir, [{ path: projectDir, sha: activeSha }]);

    const result = run(["cache", "prune"]);
    expect(result.code).toBe(0);
    expect(existsSync(join(cacheDir, "trees", activeSha))).toBe(true);
    expect(existsSync(orphanPath)).toBe(false);
  });

  it("skips projects whose lockfile no longer exists", () => {
    const sha = "c".repeat(40);
    const treePath = makeTree(cacheDir, sha);
    makeRegistry(cacheDir, [{ path: "/nonexistent/project", sha }]);

    const result = run(["cache", "prune"]);
    expect(result.code).toBe(0);
    expect(existsSync(treePath)).toBe(false);
  });

  it("succeeds with empty registry", () => {
    makeRegistry(cacheDir, []);
    const result = run(["cache", "prune"]);
    expect(result.code).toBe(0);
  });
});
