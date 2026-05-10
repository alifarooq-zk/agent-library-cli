import { describe, it, expect } from "bun:test";
import { readLockfile } from "../../src/lockfile/read.ts";
import { writeLockfile } from "../../src/lockfile/write.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";

const TEMP_PATH = "/tmp/al-test.lock";

const minimalLockfile: Lockfile = {
  version: 2,
  cliVersion: "0.1.0",
  mode: "generated",
  target: "claude",
  syncedAt: "2026-05-08T00:00:00.000Z",
  include: ["global/skills/writing-plans"],
  artifacts: [
    {
      id: "global/skills/writing-plans",
      kind: "skill",
      files: [
        {
          source: "global/skills/writing-plans/SKILL.md",
          sourceHash: "a".repeat(64),
          targets: [
            {
              path: ".claude/skills/writing-plans/SKILL.md",
              targetHash: "b".repeat(64),
              adapter: { kind: "none" },
            },
          ],
        },
      ],
    },
  ],
};

describe("lockfile round-trip", () => {
  it("round-trips a lockfile through write + read", async () => {
    const writeResult = await writeLockfile(TEMP_PATH, minimalLockfile);
    expect(writeResult.ok).toBe(true);

    const readResult = await readLockfile(TEMP_PATH);
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    expect(readResult.value).toEqual(minimalLockfile);
  });

  it("returns null when no lockfile exists", async () => {
    const result = await readLockfile("/tmp/does-not-exist.lock");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it("returns a schema failure for malformed lockfile data", async () => {
    await Bun.write(TEMP_PATH, "version: nope\n");
    const result = await readLockfile(TEMP_PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("lockfile_schema_error");
  });

  it("rejects legacy v1 adapter fields", async () => {
    await Bun.write(
      TEMP_PATH,
      [
        "version: 1",
        "cliVersion: 0.1.0",
        "mode: generated",
        "target: claude",
        "syncedAt: 2026-05-08T00:00:00.000Z",
        "include:",
        "  - global/skills/writing-plans",
        "artifacts:",
        "  - id: global/skills/writing-plans",
        "    kind: skill",
        "    files:",
        "      - source: global/skills/writing-plans/SKILL.md",
        "        sourceHash: abc123",
        "        targets:",
        "          - path: .claude/skills/writing-plans/SKILL.md",
        "            targetHash: def456",
        "            adapterSource: null",
        "            adapterHash: null",
        "",
      ].join("\n"),
    );

    const result = await readLockfile(TEMP_PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("lockfile_schema_error");
    expect(result.error.message).toBe(
      "lockfile version 1 is no longer supported; delete .agent-library.lock and run sync to regenerate",
    );
  });
});
