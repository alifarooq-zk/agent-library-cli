import { createHash } from "node:crypto";

/**
 * Compute the SHA-256 hex digest of the given bytes.
 */
export function hashBytes(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Read a file and return its SHA-256 hex digest.
 */
export async function hashFile(filePath: string): Promise<string> {
  const bytes = await Bun.file(filePath).bytes();
  return hashBytes(bytes);
}
