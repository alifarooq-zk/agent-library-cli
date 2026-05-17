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

function run(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["bun", "run", "src/cli.ts", ...args], {
    env: {
      ...process.env,
      AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH: repo.bareRepoPath,
      AGENT_LIBRARY_CACHE_DIR: cacheDir,
      NO_COLOR: "1",
      ...env,
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
      include: ["frontend/skills/react-useeffect"],
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
        include: ["frontend/skills/react-useeffect"],
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

  it("sync --global errors when the home manifest is missing", () => {
    const homeBase = mkdtempSync(join(tmpdir(), "al-sync-global-home-"));
    try {
      const result = run(["sync", "--global", "--home", homeBase]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        `error: no home manifest found at ${join(homeBase, ".agent-library.yml")}; run \`agent-lib init --global\` to create one`,
      );
    } finally {
      rmSync(homeBase, { recursive: true, force: true });
    }
  });

  it("sync --global errors when the home manifest is not home scoped", () => {
    const homeBase = mkdtempSync(join(tmpdir(), "al-sync-global-home-"));
    try {
      writeFileSync(
        join(homeBase, ".agent-library.yml"),
        stringify({
          version: 1,
          mode: "generated",
          target: "claude",
          include: ["frontend/skills/react-useeffect"],
          source: { type: "github", repo: "org/repo", ref: "main" },
        }),
      );

      const result = run(["sync", "--global", "--home", homeBase]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("must set scope: home");
    } finally {
      rmSync(homeBase, { recursive: true, force: true });
    }
  });

  it("sync --global writes the home lockfile and targets under the home base", async () => {
    const homeBase = mkdtempSync(join(tmpdir(), "al-sync-global-home-"));
    try {
      writeFileSync(
        join(homeBase, ".agent-library.yml"),
        stringify({
          version: 1,
          scope: "home",
          mode: "generated",
          target: "claude",
          include: ["global/skills/writing-plans"],
          source: { type: "github", repo: "org/repo", ref: "main" },
        }),
      );

      const result = run(["sync", "--global", "--home", homeBase]);
      expect(result.code).toBe(0);
      expect(await Bun.file(join(homeBase, ".agent-library.lock")).exists()).toBe(
        true,
      );
      expect(
        await Bun.file(
          join(homeBase, ".claude", "skills", "writing-plans", "SKILL.md"),
        ).exists(),
      ).toBe(true);

      const lockResult = await readLockfile(
        join(homeBase, ".agent-library.lock"),
      );
      expect(lockResult.ok).toBe(true);
      if (!lockResult.ok || !lockResult.value) return;
      expect(lockResult.value.source?.sha).toBe(repo.commitSha);
    } finally {
      rmSync(homeBase, { recursive: true, force: true });
    }
  });

  it("preserves lockfile source block across a --home dev-loop sync", async () => {
    const first = run(["sync", projectDir]);
    expect(first.code).toBe(0);

    const before = await readLockfile(join(projectDir, ".agent-library.lock"));
    expect(before.ok).toBe(true);
    if (!before.ok || !before.value?.source) return;

    const second = run([
      "sync",
      "--home",
      resolve("tests/fixtures/home-min"),
      projectDir,
    ]);
    expect(second.code).toBe(0);

    const after = await readLockfile(join(projectDir, ".agent-library.lock"));
    expect(after.ok).toBe(true);
    if (!after.ok || !after.value) return;
    expect(after.value.source).toEqual(before.value.source);
  });

  it("writes lockfile without source block on a --home sync with no prior lockfile", async () => {
    const result = run([
      "sync",
      "--home",
      resolve("tests/fixtures/home-min"),
      projectDir,
    ]);
    expect(result.code).toBe(0);

    const lockResult = await readLockfile(
      join(projectDir, ".agent-library.lock"),
    );
    expect(lockResult.ok).toBe(true);
    if (!lockResult.ok || !lockResult.value) return;
    expect(lockResult.value.source).toBeUndefined();
  });

  it("uses HOME_AGENT_LIBRARY as a project sync library-tree override", async () => {
    const result = run(["sync", projectDir], {
      HOME_AGENT_LIBRARY: resolve("tests/fixtures/home-min"),
      AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH: join(
        projectDir,
        "missing-remote.git",
      ),
    });
    expect(result.code).toBe(0);

    const lockResult = await readLockfile(
      join(projectDir, ".agent-library.lock"),
    );
    expect(lockResult.ok).toBe(true);
    if (!lockResult.ok || !lockResult.value) return;
    expect(lockResult.value.source).toBeUndefined();
  });
});
