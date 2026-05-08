import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { parse } from "yaml";
import { ManifestSchema } from "../../src/manifest/schema.ts";

const TEMP_PROJECT = join("/tmp", "al-test-init-project");

async function run(
  args: string[],
  input = "",
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["./bin/agent-library", ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
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
});
