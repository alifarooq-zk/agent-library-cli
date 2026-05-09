import { createHash } from "node:crypto";
import { hashHex, type HashHex } from "../artifact/types.ts";

/**
 * Compute the SHA-256 hex digest of the given bytes.
 */
export function hashBytes(data: Buffer | Uint8Array): HashHex {
  return hashHex(createHash("sha256").update(data).digest("hex"));
}

/**
 * Read a file and return its SHA-256 hex digest.
 */
export async function hashFile(filePath: string): Promise<HashHex> {
  const bytes = await Bun.file(filePath).bytes();
  return hashBytes(bytes);
}
