import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "node:path";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { parse } from "yaml";
import { ManifestSchema } from "../../src/manifest/schema.ts";
import { buildIncludeGroups } from "../../src/commands/init.ts";
import { createTestBareRepo } from "../helpers/test-bare-repo.ts";

const TEMP_PROJECT = join(process.cwd(), ".tmp", "al-test-init-project");
const HOME = resolve("tests/fixtures/home-min");
const SOURCE_FLAGS = ["--repo", "org/repo", "--ref", "main"];
const LOCAL_TREE_FLAGS = ["--home", HOME];

async function run(
  args: string[],
  input = "",
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME_AGENT_LIBRARY: HOME, NO_COLOR: "1", ...env },
  });

  proc.stdin.write(input);
  proc.stdin.end();

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;

  return { stdout, stderr, code };
}

function resetProject() {
  rmSync(TEMP_PROJECT, { recursive: true, force: true });
  mkdirSync(TEMP_PROJECT, { recursive: true });
}

describe("init command", () => {
  beforeEach(resetProject);
  afterEach(() => {
    rmSync(TEMP_PROJECT, { recursive: true, force: true });
  });

  it("creates a manifest from prompt defaults and refuses overwrite", async () => {
    const first = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "\n\n\n",
    );
    expect(first.code).toBe(0);

    const manifestPath = join(TEMP_PROJECT, ".agent-library.yml");
    const manifest = parse(await Bun.file(manifestPath).text());
    const parsed = ManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      version: 1,
      scope: "project",
      mode: "generated",
      target: "both",
      include: ["frontend"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    });
    expect(manifest.scope).toBeUndefined();

    const second = await run([
      "init",
      ...SOURCE_FLAGS,
      ...LOCAL_TREE_FLAGS,
      TEMP_PROJECT,
    ]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain(
      `manifest already exists at ${manifestPath}`,
    );
  });

  // --- stdin validation branches ---

  it("rejects an invalid mode", async () => {
    const r = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "badmode\n\n\n",
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("mode must be generated or vendored");
  });

  it("rejects an invalid target", async () => {
    const r = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "\nbadtarget\n\n",
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("target must be codex, claude, or both");
  });

  it("rejects a comma-only include that parses to empty", async () => {
    // valueOrDefault sees ",," (non-empty string) but parseInclude strips it to []
    const r = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "\n\n,,\n",
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("include must have at least one entry");
  });

  // --- explicit value paths ---

  it("creates a manifest with vendored mode", async () => {
    const r = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "vendored\n\n\n",
    );
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.mode).toBe("vendored");
  });

  it("creates a manifest with claude target", async () => {
    const r = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "\nclaude\n\n",
    );
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.target).toBe("claude");
  });

  it("creates a manifest with codex target", async () => {
    const r = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "\ncodex\n\n",
    );
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.target).toBe("codex");
  });

  it("rejects an explicit global include without --global", async () => {
    const r = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "\n\nglobal/skills/writing-plans\n",
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      '"global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.',
    );
  });

  it("rejects multiple explicit global include entries without --global", async () => {
    const r = await run(
      ["init", ...SOURCE_FLAGS, ...LOCAL_TREE_FLAGS, TEMP_PROJECT],
      "\n\nglobal/skills/writing-plans,global/commands/review-pr\n",
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      '"global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.',
    );
  });

  it("creates a home-scoped manifest with --global", async () => {
    const r = await run(
      ["init", "--global", ...SOURCE_FLAGS, "--home", TEMP_PROJECT],
      "\n\nglobal/skills/writing-plans\n",
    );
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest).toEqual({
      version: 1,
      scope: "home",
      mode: "generated",
      target: "both",
      include: ["global/skills/writing-plans"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    });
  });

  it("keeps the home default include when --global is set", async () => {
    const r = await run(
      ["init", "--global", ...SOURCE_FLAGS, "--home", TEMP_PROJECT],
      "\n\n\n",
    );
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.scope).toBe("home");
    expect(manifest.include).toEqual(["profile:universal"]);
  });

  it("defaults --global init to the global domain when universal profile is absent", async () => {
    const sourceDir = join(process.cwd(), ".tmp", "al-home-no-profiles");
    const cacheDir = join(process.cwd(), ".tmp", "al-init-global-cache");
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
    cpSync(HOME, sourceDir, { recursive: true });
    rmSync(join(sourceDir, "profiles"), { recursive: true, force: true });
    const repo = await createTestBareRepo(sourceDir);

    try {
      const r = await run(
        ["init", "--global", ...SOURCE_FLAGS, "--home", TEMP_PROJECT],
        "\n\n\n",
        {
          AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH: repo.bareRepoPath,
          AGENT_LIBRARY_CACHE_DIR: cacheDir,
        },
      );
      expect(r.code).toBe(0);

      const manifest = parse(
        await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
      );
      expect(manifest.scope).toBe("home");
      expect(manifest.include).toEqual(["global"]);
    } finally {
      repo.cleanup();
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("fails non-interactive init without --repo/--ref", async () => {
    const r = await run(["init", TEMP_PROJECT]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "--repo and --ref are required in non-interactive mode",
    );
  });

  it("fails non-interactive --global init when the home manifest exists", async () => {
    const first = await run(
      ["init", "--global", ...SOURCE_FLAGS, "--home", TEMP_PROJECT],
      "\n\n\n",
    );
    expect(first.code).toBe(0);

    const second = await run([
      "init",
      "--global",
      ...SOURCE_FLAGS,
      "--home",
      TEMP_PROJECT,
    ]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain(
      `manifest already exists at ${join(TEMP_PROJECT, ".agent-library.yml")}`,
    );
  });

  it("materializes the source tree when --home is omitted", async () => {
    const repo = await createTestBareRepo(HOME);
    const cacheDir = join(process.cwd(), ".tmp", "al-init-cache");
    rmSync(cacheDir, { recursive: true, force: true });
    try {
      const r = await run(
        ["init", ...SOURCE_FLAGS, TEMP_PROJECT],
        "\n\n\n",
        {
          AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH: repo.bareRepoPath,
          AGENT_LIBRARY_CACHE_DIR: cacheDir,
        },
      );
      expect(r.code).toBe(0);

      const manifest = parse(
        await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
      );
      expect(manifest.include).toEqual(["frontend"]);
      expect(manifest.source).toEqual({
        type: "github",
        repo: "org/repo",
        ref: "main",
      });
      expect(existsSync(join(cacheDir, "trees", repo.commitSha))).toBe(true);
    } finally {
      repo.cleanup();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("falls back to typed includes when source materialization fails", async () => {
    const r = await run(
      ["init", ...SOURCE_FLAGS, TEMP_PROJECT],
      "\n\nfrontend/skills/react-useeffect\n",
      {
        AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH: join(
          process.cwd(),
          ".tmp",
          "missing.git",
        ),
      },
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("can't reach github.com");

    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.include).toEqual(["frontend/skills/react-useeffect"]);
    expect(manifest.source).toEqual({
      type: "github",
      repo: "org/repo",
      ref: "main",
    });
  });

  it("filters global domain and global profiles from project include groups", async () => {
    const groups = await buildIncludeGroups(HOME, { allowGlobal: false });

    expect(groups.global).toBeUndefined();
    expect(groups.Profiles?.map((option) => option.value) ?? []).not.toContain(
      "profile:universal",
    );
    expect(groups.frontend?.some((option) => option.value === "frontend")).toBe(
      true,
    );
  });

  it("keeps global domain and profiles in home include groups", async () => {
    const groups = await buildIncludeGroups(HOME, { allowGlobal: true });

    expect(groups.global?.some((option) => option.value === "global")).toBe(
      true,
    );
    expect(groups.Profiles?.map((option) => option.value)).toContain(
      "profile:universal",
    );
  });
});
