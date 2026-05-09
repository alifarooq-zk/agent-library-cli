import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { writeFileAtomic } from "../../src/util/fs.ts";

let tempRoot: string | null = null;

describe("writeFileAtomic", () => {
  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it("removes the temporary file when rename fails", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "al-test-fs-"));
    const target = join(tempRoot, "target");
    mkdirSync(target);
    await Bun.write(join(target, "existing.txt"), "existing");

    await expect(writeFileAtomic(target, "new content")).rejects.toThrow();

    expect(await Bun.file(`${target}.tmp`).exists()).toBe(false);
  });
});
