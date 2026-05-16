import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRegistry,
  upsertProjectEntry,
} from "../../src/cache/registry.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "al-reg-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const registryPath = () => join(dir, "projects.json");

describe("readRegistry", () => {
  it("returns empty projects array when file does not exist", async () => {
    const result = await readRegistry(registryPath());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.projects).toEqual([]);
  });
});

describe("upsertProjectEntry", () => {
  it("creates the registry file and adds the first entry", async () => {
    const entry = {
      path: "/home/user/project-a",
      repo: "org/repo",
      ref: "main",
      sha: "a".repeat(40),
      lastSyncedAt: "2026-05-11T00:00:00.000Z",
    };

    const writeResult = await upsertProjectEntry(registryPath(), entry);
    expect(writeResult.ok).toBe(true);

    const readResult = await readRegistry(registryPath());
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.projects).toHaveLength(1);
      expect(readResult.value.projects[0]!.path).toBe(
        "/home/user/project-a",
      );
    }
  });

  it("updates an existing entry in-place (same path, new sha)", async () => {
    const base = {
      path: "/home/user/project-a",
      repo: "org/repo",
      ref: "main",
      sha: "a".repeat(40),
      lastSyncedAt: "2026-05-11T00:00:00.000Z",
    };
    await upsertProjectEntry(registryPath(), base);
    await upsertProjectEntry(registryPath(), { ...base, sha: "b".repeat(40) });

    const readResult = await readRegistry(registryPath());
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.projects).toHaveLength(1);
      expect(readResult.value.projects[0]!.sha).toBe("b".repeat(40));
    }
  });

  it("appends a second entry for a different project path", async () => {
    await upsertProjectEntry(registryPath(), {
      path: "/home/user/project-a",
      repo: "org/repo",
      ref: "main",
      sha: "a".repeat(40),
      lastSyncedAt: "2026-05-11T00:00:00.000Z",
    });
    await upsertProjectEntry(registryPath(), {
      path: "/home/user/project-b",
      repo: "org/repo",
      ref: "main",
      sha: "b".repeat(40),
      lastSyncedAt: "2026-05-11T00:00:00.000Z",
    });

    const readResult = await readRegistry(registryPath());
    expect(readResult.ok).toBe(true);
    if (readResult.ok) expect(readResult.value.projects).toHaveLength(2);
  });
});
