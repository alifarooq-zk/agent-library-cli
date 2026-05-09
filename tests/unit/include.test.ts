import { describe, it, expect } from "bun:test";
import {
  parseIncludeEntry,
  profileNameFromInclude,
} from "../../src/manifest/include.ts";

describe("include entry parsing", () => {
  it("brands profile includes and extracts the profile name", () => {
    const entry = parseIncludeEntry("profile:frontend");
    expect(entry.kind).toBe("profile");
    if (entry.kind !== "profile") return;
    expect(profileNameFromInclude(entry.value)).toBe("frontend");
  });

  it("brands project-local includes", () => {
    const entry = parseIncludeEntry("./product/skills/domain-review");
    expect(entry.kind).toBe("local");
    if (entry.kind !== "local") return;
    expect(String(entry.value)).toBe("./product/skills/domain-review");
  });

  it("brands library includes", () => {
    const entry = parseIncludeEntry("global/skills/writing-plans");
    expect(entry.kind).toBe("library");
    if (entry.kind !== "library") return;
    expect(String(entry.value)).toBe("global/skills/writing-plans");
  });
});
