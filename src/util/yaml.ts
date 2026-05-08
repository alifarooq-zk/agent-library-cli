import { parse } from "yaml";
import { ResultKit, type TypedError, type Result } from "./result-kit/index.ts";

export type YamlReadError = TypedError<"yaml_read_error">;

export async function readYaml<T = unknown>(
  path: string,
): Promise<Result<T, YamlReadError>> {
  return ResultKit.fromPromise(
    Bun.file(path)
      .text()
      .then((text) => parse(text) as T),
    (cause) => ({
      type: "yaml_read_error" as const,
      message: `cannot read YAML file at ${path}`,
      cause,
    }),
  );
}
