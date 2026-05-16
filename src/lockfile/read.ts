import { parse } from "yaml";
import { LockfileSchema, type Lockfile } from "./schema.ts";
import {
  ResultKit,
  type Result,
  type TypedErrorUnion,
} from "../util/result-kit/index.ts";

export type LockfileReadError = TypedErrorUnion<
  "lockfile_read_error" | "lockfile_parse_error" | "lockfile_schema_error"
>;

/**
 * Read and parse a lockfile from disk.
 * Returns null only when the lockfile is absent.
 */
export async function readLockfile(
  filePath: string,
): Promise<Result<Lockfile | null, LockfileReadError>> {
  const file = Bun.file(filePath);
  const existsResult = await ResultKit.fromPromise(file.exists(), (cause) => ({
    type: "lockfile_read_error" as const,
    message: `cannot stat lockfile at ${filePath}`,
    cause,
  }));

  if (!existsResult.ok) return existsResult;
  if (!existsResult.value) return ResultKit.success(null);

  const textResult = await ResultKit.fromPromise(file.text(), (cause) => ({
    type: "lockfile_read_error" as const,
    message: `cannot read lockfile at ${filePath}`,
    cause,
  }));

  if (!textResult.ok) return textResult;

  const parseYaml = ResultKit.fromThrowable(
    (text: string) => parse(text) as unknown,
    (cause) => ({
      type: "lockfile_parse_error" as const,
      message: `lockfile at ${filePath} contains invalid YAML`,
      cause,
    }),
  );
  const rawResult = parseYaml(textResult.value);
  if (!rawResult.ok) return rawResult;

  if (
    rawResult.value &&
    typeof rawResult.value === "object" &&
    "version" in rawResult.value &&
    rawResult.value.version === 2
  ) {
    return ResultKit.failure({
      type: "lockfile_schema_error" as const,
      message:
        "lockfile version 2 is no longer supported; delete .agent-library.lock and run sync to regenerate",
    });
  }

  const result = LockfileSchema.safeParse(rawResult.value);
  if (!result.success) {
    return ResultKit.failure({
      type: "lockfile_schema_error" as const,
      message: `lockfile at ${filePath} failed schema validation`,
      cause: result.error,
    });
  }

  return ResultKit.success(result.data);
}
