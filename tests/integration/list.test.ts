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
import {
  createTestBareRepo,
  type TestBareRepo,
} from "../helpers/test-bare-repo.ts";

const HOME = resolve("tests/fixtures/home-min");
const CLI = resolve("src/cli.ts");
let repo: TestBareRepo;
let cacheDir: string;
let projectDir: string;

function run(
  args: string[],
  cwd = projectDir,
): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["bun", "run", CLI, ...args], {
    cwd,
    env: {
      ...process.env,
      AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH: repo.bareRepoPath,
      AGENT_LIBRARY_CACHE_DIR: cacheDir,
      NO_COLOR: "1",
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
  cacheDir = mkdtempSync(join(tmpdir(), "al-list-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "al-list-project-"));
  writeManifest(projectDir);
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("list command", () => {
  it("reads a project lockfile and lists the pinned catalogue", () => {
    const sync = run(["sync", projectDir]);
    expect(sync.code).toBe(0);

    const r = run(["list", "artifacts"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("frontend/skills/react-useeffect");
    expect(r.stdout).toContain("global/skills/writing-plans");
  });

  it("list --home uses the override tree without a manifest", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "al-list-empty-"));
    try {
      const r = run(["list", "domains", "--home", HOME], emptyDir);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("global");
      expect(r.stdout).toContain("frontend");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("errors outside a project when --home is omitted", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "al-list-empty-"));
    try {
      const r = run(["list", "domains"], emptyDir);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(
        "no manifest in current directory; pass `--home <path>` or run from a project root",
      );
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("fetches manifest ref HEAD with a warning when no lockfile exists", () => {
    const r = run(["list", "profiles"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("not a pinned SHA");
    expect(r.stdout).toContain("universal");
    expect(r.stdout).toContain("frontend");
  });

  it("filters artifacts by domain and type from the resolved tree", () => {
    const sync = run(["sync", projectDir]);
    expect(sync.code).toBe(0);

    const r = run([
      "list",
      "artifacts",
      "--type",
      "skill",
      "--domain",
      "global",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("global/skills/writing-plans");
    expect(r.stdout).not.toContain("global/agents/security-reviewer");
  });
});

function writeManifest(dir: string): void {
  cpSync(resolve("tests/fixtures/projects/p1-skill-only"), dir, {
    recursive: true,
  });
  writeFileSync(
    join(dir, ".agent-library.yml"),
    stringify({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["frontend/skills/react-useeffect"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    }),
  );
}
