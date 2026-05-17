import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createTestBareRepo,
  type TestBareRepo,
} from "../helpers/test-bare-repo.ts";

let repo: TestBareRepo;
let cacheDir: string;
let workDir: string;
const CLI = resolve("src/cli.ts");

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["bun", "run", CLI, ...args], {
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
  cacheDir = mkdtempSync(join(tmpdir(), "al-validate-cache-"));
  workDir = mkdtempSync(join(tmpdir(), "al-validate-work-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

describe("validate command", () => {
  it("validates structurally and resolves includes from the pinned tree", () => {
    const project = copyProject("validate-valid");
    const sync = run(["sync", "--global", "--home", project]);
    expect(sync.code).toBe(0);

    const r = run(["validate", project]);
    expect(r.code).toBe(0);
  });

  it("exits 1 and names the missing version field", () => {
    const project = copyProject("validate-missing-version");
    const r = run(["validate", "--no-resolve", project]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/version/);
  });

  it("exits 1 for project manifests that include global directly", () => {
    const project = copyProject("validate-project-global");
    const r = run(["validate", project]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      'error: "global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.',
    );
  });

  it("exits 1 for project manifests whose profile resolves global artifacts", () => {
    const seeded = copyProject("validate-valid");
    const sync = run(["sync", "--global", "--home", seeded]);
    expect(sync.code).toBe(0);

    const project = copyProject("validate-project-global-profile");
    cpSync(
      join(seeded, ".agent-library.lock"),
      join(project, ".agent-library.lock"),
    );

    const r = run(["validate", project]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      'error: "global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.',
    );
  });

  it("allows global includes for home-scoped manifests", () => {
    const project = copyProject("validate-home-global");
    const sync = run(["sync", "--global", "--home", project]);
    expect(sync.code).toBe(0);

    const r = run(["validate", project]);
    expect(r.code).toBe(0);
  });

  it("errors on a valid manifest without a lockfile", () => {
    const project = copyProject("validate-valid");
    const r = run(["validate", project]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "no lockfile found; run `agent-library sync` first, or pass `--no-resolve`",
    );
  });

  it("validate --no-resolve skips include-resolution", () => {
    const project = copyProject("validate-valid");
    const r = run(["validate", "--no-resolve", project]);
    expect(r.code).toBe(0);
  });
});

function copyProject(name: string): string {
  const dest = join(workDir, name);
  cpSync(resolve("tests/fixtures/projects", name), dest, { recursive: true });
  return dest;
}
