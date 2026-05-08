import { stringify } from "yaml";
import type { Lockfile } from "./schema.ts";
import { writeFileAtomic } from "../util/fs.ts";
import {
  ResultKit,
  type Result,
  type TypedError,
} from "../util/result-kit/index.ts";

export type LockfileWriteError = TypedError<"lockfile_write_error">;

/**
 * Serialize and write a lockfile to disk atomically.
 * Writes to a .tmp file first then renames into place to prevent partial writes.
 */
export async function writeLockfile(
  filePath: string,
  data: Lockfile,
): Promise<Result<void, LockfileWriteError>> {
  const text = stringify(data, { lineWidth: 0 });
  return ResultKit.fromPromise(writeFileAtomic(filePath, text), (cause) => ({
    type: "lockfile_write_error" as const,
    message: `cannot write lockfile at ${filePath}`,
    cause,
  }));
}
