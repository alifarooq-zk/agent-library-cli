import { describe, it, expect } from "bun:test";
import { validateManifest } from "../../src/manifest/validate.ts";
import { loadManifest } from "../../src/manifest/load.ts";

describe("validateManifest", () => {
  it("accepts a fully populated valid manifest", async () => {
    const result = await loadManifest("tests/fixtures/manifests/valid.yml");
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues).toEqual([]);
  });

  it("rejects missing version with a field-specific message", async () => {
    const result = await loadManifest(
      "tests/fixtures/manifests/missing-version.yml",
    );
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("version");
    expect(issues[0].message).toMatch(/required/i);
  });

  it("rejects unknown mode value", async () => {
    const result = await loadManifest("tests/fixtures/manifests/bad-mode.yml");
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues[0].path).toBe("mode");
    expect(issues[0].message).toMatch(/generated|vendored/);
  });

  it("rejects unknown target value", async () => {
    const result = await loadManifest(
      "tests/fixtures/manifests/bad-target.yml",
    );
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues[0].path).toBe("target");
  });

  it("rejects empty include array", async () => {
    const result = await loadManifest(
      "tests/fixtures/manifests/empty-include.yml",
    );
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const issues = validateManifest(result.value);
    expect(issues[0].path).toBe("include");
    expect(issues[0].message).toMatch(/non-empty|at least one/i);
  });

  it("returns a yaml_read_error failure for a missing file", async () => {
    const result = await loadManifest(
      "tests/fixtures/manifests/does-not-exist.yml",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("yaml_read_error");
  });
});
