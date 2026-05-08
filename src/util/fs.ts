import { rename } from "node:fs/promises";

/**
 * Write content atomically: write to a .tmp file, then rename into place.
 * Bun.write() creates intermediate directories automatically.
 * This prevents partial writes from leaving a corrupt target.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await Bun.write(tmp, content);
  await rename(tmp, filePath);
}

/**
 * Read a file, returning null if it doesn't exist.
 */
export async function readFileMaybe(
  filePath: string,
): Promise<Uint8Array | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return file.bytes();
}
