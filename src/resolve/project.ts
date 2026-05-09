import { isAbsolute, relative, resolve } from "node:path";
import { expandBundle, type BundleResolveError } from "./bundles.ts";
import { withArtifactId, type Artifact } from "../artifact/types.ts";
import type { LocalIncludeRef } from "../manifest/include.ts";
import { ResultKit, type Result } from "../util/result-kit/index.ts";

/**
 * Resolve a project-local include entry against <projectRoot>/.agent-library.
 * The returned artifact ids keep the manifest's './' prefix so generated
 * headers and lockfiles can distinguish local assets from home-library assets.
 */
export function resolveLocalIncludeEntry(
  projectRoot: string,
  entry: LocalIncludeRef,
): Result<Artifact[], BundleResolveError> {
  const localRoot = resolve(projectRoot, ".agent-library");
  const localEntry = entry.slice("./".length);
  const resolvedEntry = resolve(localRoot, localEntry);
  const relativeEntry = relative(localRoot, resolvedEntry);

  if (
    isAbsolute(localEntry) ||
    relativeEntry.startsWith("..") ||
    isAbsolute(relativeEntry)
  ) {
    return ResultKit.failure({
      type: "bundle_path_too_deep" as const,
      message: `cannot resolve '${entry}': project-local include paths must stay under ${localRoot}`,
    });
  }

  const result = expandBundle(localRoot, relativeEntry);

  if (!result.ok) return result;

  return ResultKit.success(
    result.value.map((artifact) => withArtifactId(artifact, `./${artifact.id}`)),
  );
}
