import { describe, it, expect } from "bun:test";
import { ManifestSchema } from "../../src/manifest/schema.ts";

describe("ManifestSchema source block", () => {
  it("parses a manifest with a valid source block", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/foo"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source?.type).toBe("github");
      expect(result.data.source?.repo).toBe("org/repo");
      expect(result.data.source?.ref).toBe("main");
    }
  });

  it("rejects a manifest without source", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/foo"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects source.type other than github", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/foo"],
      source: { type: "local", repo: "org/repo", ref: "main" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects source with missing ref", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/foo"],
      source: { type: "github", repo: "org/repo" },
    });
    expect(result.success).toBe(false);
  });
});
