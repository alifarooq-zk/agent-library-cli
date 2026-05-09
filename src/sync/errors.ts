import type { TypedErrorUnion } from "../util/result-kit/index.ts";

export type SyncFileError = TypedErrorUnion<
  | "sync_file_read_error"
  | "sync_file_write_error"
  | "sync_file_delete_error"
  | "sync_file_stat_error"
>;

export interface SyncFileErrorDetails extends Record<string, unknown> {
  readonly path: string;
  readonly role: string;
  readonly writtenTargets?: readonly string[];
}

export function syncFileError(input: {
  readonly type: SyncFileError["type"];
  readonly path: string;
  readonly role: string;
  readonly cause?: unknown;
  readonly writtenTargets?: readonly string[];
}): SyncFileError {
  const details: SyncFileErrorDetails = input.writtenTargets
    ? {
        path: input.path,
        role: input.role,
        writtenTargets: input.writtenTargets,
      }
    : { path: input.path, role: input.role };

  return {
    type: input.type,
    message: `${input.role} failed at ${input.path}`,
    details,
    cause: input.cause,
  };
}
