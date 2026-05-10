import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hashBytes } from "../../src/lockfile/hash.ts";
import {
  absolutePath,
  createSkillArtifact,
  relativePath,
} from "../../src/artifact/types.ts";
import type { PlanFileWrite, SyncPlan } from "../../src/sync/plan.ts";
import {
  buildLockfileFromTargetEntries,
  buildLockfileFromWrittenContents,
  existingTargetLockEntry,
  writtenTargetLockEntry,
} from "../../src/sync/lockfile.ts";
import { runGeneratedSync } from "../../src/sync/generated.ts";
import { runVendoredSync } from "../../src/sync/vendored.ts";

let tempRoot: string;

function paths() {
  const libraryRoot = join(tempRoot, "home");
  const projectRoot = join(tempRoot, "project");
  const skillRoot = join(libraryRoot, "global", "skills", "demo");
  const sourceFile = join(skillRoot, "SKILL.md");
  const adapterSource = join(skillRoot, "adapters", "claude.md");
  const targetFile = join(projectRoot, ".claude", "skills", "demo", "SKILL.md");

  return {
    libraryRoot,
    projectRoot,
    skillRoot,
    sourceFile,
    adapterSource,
    targetFile,
    targetRelative: ".claude/skills/demo/SKILL.md",
  };
}

async function writeSources(
  input: {
    readonly adapter?: boolean;
    readonly sourceText?: string;
  } = {},
) {
  const p = paths();
  await Bun.write(p.sourceFile, input.sourceText ?? "# Demo\n");
  if (input.adapter) await Bun.write(p.adapterSource, "Adapter note\n");
}

function makeWrite(input: { readonly adapter?: boolean } = {}): PlanFileWrite {
  const p = paths();
  const artifact = createSkillArtifact({
    id: "global/skills/demo",
    domain: "global",
    basename: "demo",
    libraryRoot: p.libraryRoot,
    rootDir: p.skillRoot,
    primarySourceFile: p.sourceFile,
  });

  return {
    artifact,
    source: {
      filePath: absolutePath(p.sourceFile),
      contentKind: "markdown",
      preserveFrontmatter: true,
    },
    target: {
      targetDir: "claude",
      filePath: absolutePath(p.targetFile),
      relativePath: relativePath(p.targetRelative),
    },
    adapter: input.adapter
      ? { kind: "applied", sourceFile: absolutePath(p.adapterSource) }
      : { kind: "none" },
  };
}

function makePlan(
  input: {
    readonly mode?: "generated" | "vendored";
    readonly adapter?: boolean;
  } = {},
): SyncPlan {
  return {
    mode: input.mode ?? "generated",
    target: "claude",
    projectRoot: absolutePath(paths().projectRoot),
    include: ["global/skills/demo"],
    writes: [makeWrite({ adapter: input.adapter })],
  };
}

describe("sync lockfile failure paths", () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "al-test-sync-lockfile-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns a typed read failure when a lockfile source is missing", async () => {
    await writeSources();
    const write = makeWrite();
    rmSync(paths().sourceFile);

    const result = await buildLockfileFromTargetEntries(makePlan(), [
      existingTargetLockEntry(write, "target-hash", { kind: "none" }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("sync_file_read_error");
    expect(result.error.details?.path).toBe(paths().sourceFile);
  });

  it("returns a typed read failure when a lockfile adapter is missing", async () => {
    await writeSources({ adapter: true });
    const write = makeWrite({ adapter: true });
    rmSync(paths().adapterSource);

    const result = await writtenTargetLockEntry(write, "content");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("sync_file_read_error");
    expect(result.error.details?.path).toBe(paths().adapterSource);
  });

  it("returns a typed failure when written content is missing", async () => {
    await writeSources();

    const result = await buildLockfileFromWrittenContents(
      makePlan(),
      new Map(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("sync_file_read_error");
    expect(result.error.details?.path).toBe(paths().targetRelative);
  });

  it("hashes empty written content instead of stale disk content", async () => {
    await writeSources();
    await Bun.write(paths().targetFile, "stale target content");

    const result = await buildLockfileFromWrittenContents(
      makePlan(),
      new Map([[paths().targetRelative, ""]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = result.value.artifacts[0].files[0].targets[0];
    expect(target.targetHash).toBe(hashBytes(Buffer.from("", "utf8")));
    expect(target.targetHash).not.toBe(
      hashBytes(Buffer.from("stale target content", "utf8")),
    );
  });

  it("generated sync returns a typed failure when a planned source disappears", async () => {
    await writeSources();
    const plan = makePlan({ mode: "generated" });
    rmSync(paths().sourceFile);

    const result = await runGeneratedSync(plan);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("sync_file_read_error");
    expect(
      await Bun.file(join(paths().projectRoot, ".agent-library.lock")).exists(),
    ).toBe(false);
  });

  it("vendored sync returns a typed failure when a planned adapter disappears", async () => {
    await writeSources({ adapter: true });
    const plan = makePlan({ mode: "vendored", adapter: true });
    rmSync(paths().adapterSource);

    const result = await runVendoredSync(plan);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("sync_file_read_error");
    expect(result.error.details?.path).toBe(paths().adapterSource);
  });
});
