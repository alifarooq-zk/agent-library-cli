import { describe, it, expect } from "bun:test";
import { resolveHomePaths } from "../../src/util/home.ts";

describe("resolveHomePaths", () => {
  it("uses USERPROFILE on win32", () => {
    const paths = resolveHomePaths("win32", {
      USERPROFILE: "C:\\Users\\A",
    } as any);
    expect(paths.manifest).toBe("C:\\Users\\A\\.agent-library.yml");
    expect(paths.lockfile).toBe("C:\\Users\\A\\.agent-library.lock");
    expect(paths.claude).toBe("C:\\Users\\A\\.claude");
    expect(paths.agents).toBe("C:\\Users\\A\\.agents");
  });

  it("uses homedir on non-win32", () => {
    const paths = resolveHomePaths("linux", { HOME: "/home/al" } as any);
    expect(paths.manifest).toBe("/home/al/.agent-library.yml");
  });

  it("respects override path", () => {
    const paths = resolveHomePaths(
      "linux",
      { HOME: "/home/al" } as any,
      "/tmp/home",
    );
    expect(paths.manifest).toBe("/tmp/home/.agent-library.yml");
  });
});
