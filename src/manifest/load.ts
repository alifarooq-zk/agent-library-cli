import { readYaml, type YamlReadError } from "../util/yaml.ts";
import type { Result } from "../util/result-kit/index.ts";

export async function loadManifest(
  path: string,
): Promise<Result<unknown, YamlReadError>> {
  return readYaml(path);
}
