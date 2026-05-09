import { describe, it, expect } from "bun:test";
import { hashBytes } from "../../src/lockfile/hash.ts";

describe("hashBytes", () => {
  it("produces stable sha256 for the same bytes", () => {
    expect(hashBytes(Buffer.from("hello"))).toBe(
      hashBytes(Buffer.from("hello")),
    );
    expect(hashBytes(Buffer.from("hello"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different bytes", () => {
    expect(hashBytes(Buffer.from("hello"))).not.toBe(
      hashBytes(Buffer.from("world")),
    );
  });

  it("produces correct known sha256", () => {
    // echo -n 'hello' | sha256sum => 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(String(hashBytes(Buffer.from("hello")))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});
