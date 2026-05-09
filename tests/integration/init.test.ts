import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { parse } from "yaml";
import { ManifestSchema } from "../../src/manifest/schema.ts";

const TEMP_PROJECT = join("/tmp", "al-test-init-project");
const HOME = "tests/fixtures/home-min";

async function run(
  args: string[],
  input = "",
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["./bin/agent-library", ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME_AGENT_LIBRARY: HOME, NO_COLOR: "1" },
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
    const first = await run(["init", TEMP_PROJECT], "\n\n\n");
    expect(first.code).toBe(0);

    const manifestPath = join(TEMP_PROJECT, ".agent-library.yml");
    const manifest = parse(await Bun.file(manifestPath).text());
    const parsed = ManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["profile:universal"],
    });

    const second = await run(["init", TEMP_PROJECT]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain(
      `manifest already exists at ${manifestPath}`,
    );
  });

  // --- stdin validation branches ---

  it("rejects an invalid mode", async () => {
    const r = await run(["init", TEMP_PROJECT], "badmode\n\n\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("mode must be generated or vendored");
  });

  it("rejects an invalid target", async () => {
    const r = await run(["init", TEMP_PROJECT], "\nbadtarget\n\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("target must be codex, claude, or both");
  });

  it("rejects a comma-only include that parses to empty", async () => {
    // valueOrDefault sees ",," (non-empty string) but parseInclude strips it to []
    const r = await run(["init", TEMP_PROJECT], "\n\n,,\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("include must have at least one entry");
  });

  // --- explicit value paths ---

  it("creates a manifest with vendored mode", async () => {
    const r = await run(["init", TEMP_PROJECT], "vendored\n\n\n");
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.mode).toBe("vendored");
  });

  it("creates a manifest with claude target", async () => {
    const r = await run(["init", TEMP_PROJECT], "\nclaude\n\n");
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.target).toBe("claude");
  });

  it("creates a manifest with codex target", async () => {
    const r = await run(["init", TEMP_PROJECT], "\ncodex\n\n");
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.target).toBe("codex");
  });

  it("creates a manifest with an explicit include entry", async () => {
    const r = await run(
      ["init", TEMP_PROJECT],
      "\n\nglobal/skills/writing-plans\n",
    );
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.include).toEqual(["global/skills/writing-plans"]);
  });

  it("creates a manifest with multiple comma-separated include entries", async () => {
    const r = await run(
      ["init", TEMP_PROJECT],
      "\n\nglobal/skills/writing-plans,global/commands/review-pr\n",
    );
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.include).toEqual([
      "global/skills/writing-plans",
      "global/commands/review-pr",
    ]);
  });
});
