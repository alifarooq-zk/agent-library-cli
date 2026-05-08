import { join } from "node:path";
import { readYaml } from "../util/yaml.ts";
import {
  ResultKit,
  type TypedErrorUnion,
  type Result,
} from "../util/result-kit/index.ts";

interface ProfileFile {
  include: string[];
}

export type ProfileResolveError = TypedErrorUnion<
  "profile_not_found" | "profile_nested"
>;

/**
 * Load a named profile from <homeRoot>/profiles/<name>.yml.
 * Returns a failure if the file cannot be read or if any include entry is
 * itself a profile reference (nested profiles are not supported).
 */
export async function loadProfile(
  homeRoot: string,
  name: string,
): Promise<Result<string[], ProfileResolveError>> {
  const profilePath = join(homeRoot, "profiles", `${name}.yml`);
  const fileResult = await readYaml<ProfileFile>(profilePath);

  if (!fileResult.ok) {
    return ResultKit.failure({
      type: "profile_not_found" as const,
      message: `cannot load profile '${name}': file not found at ${profilePath}`,
      cause: fileResult.error.cause,
    });
  }

  const entries: string[] = Array.isArray(fileResult.value?.include)
    ? fileResult.value.include
    : [];

  for (const entry of entries) {
    if (entry.startsWith("profile:")) {
      return ResultKit.failure({
        type: "profile_nested" as const,
        message: `profile '${name}' may not include another profile ('${entry}'): nested profiles are not supported`,
      });
    }
  }

  return ResultKit.success(entries);
}
