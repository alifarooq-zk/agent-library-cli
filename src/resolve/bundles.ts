import { join } from "node:path";
import { existsSync } from "node:fs";
import { discoverDomain, classifyArtifact } from "../artifact/discover.ts";
import type { Artifact } from "../artifact/types.ts";
import {
  ResultKit,
  type TypedErrorUnion,
  type Result,
} from "../util/result-kit/index.ts";

export type BundleResolveError = TypedErrorUnion<
  "bundle_not_found" | "bundle_no_artifacts" | "bundle_path_too_deep"
>;

/**
 * Expand an id path into a list of artifacts.
 *
 * - If idPath is a domain root (e.g. 'global'), discover all artifacts in that domain.
 * - If idPath is a category path (e.g. 'frontend/skills'), discover all in that category.
 * - If idPath is a concrete artifact path (e.g. 'frontend/skills/react-useeffect'), return one artifact.
 * - Returns a failure result if nothing matches.
 */
export function expandBundle(
  libraryRoot: string,
  idPath: string,
): Result<Artifact[], BundleResolveError> {
  const parts = idPath.split("/");

  // Domain-only: 'global'
  if (parts.length === 1) {
    const domain = parts[0];
    const domainDir = join(libraryRoot, domain);
    if (!existsSync(domainDir)) {
      return ResultKit.failure({
        type: "bundle_not_found" as const,
        message: `cannot resolve '${idPath}': directory not found at ${domainDir}`,
      });
    }
    const artifacts = discoverDomain(libraryRoot, domain);
    if (artifacts.length === 0) {
      return ResultKit.failure({
        type: "bundle_no_artifacts" as const,
        message: `cannot resolve '${idPath}': no artifacts found under ${domainDir}`,
      });
    }
    return ResultKit.success(artifacts);
  }

  const domain = parts[0];
  const category = parts[1];

  // Category-level bundle: 'frontend/skills'
  if (parts.length === 2) {
    const categoryDir = join(libraryRoot, domain, category);
    if (!existsSync(categoryDir)) {
      return ResultKit.failure({
        type: "bundle_not_found" as const,
        message: `cannot resolve '${idPath}': directory not found at ${categoryDir}`,
      });
    }
    const allInDomain = discoverDomain(libraryRoot, domain);
    const filtered = allInDomain.filter((a) =>
      a.id.startsWith(`${domain}/${category}/`),
    );
    if (filtered.length === 0) {
      return ResultKit.failure({
        type: "bundle_no_artifacts" as const,
        message: `cannot resolve '${idPath}': no artifacts found under ${categoryDir}`,
      });
    }
    return ResultKit.success(filtered);
  }

  // Concrete artifact: 'frontend/skills/react-useeffect'
  if (parts.length === 3) {
    const name = parts[2];
    const artifact = classifyArtifact(libraryRoot, domain, category, name);
    if (!artifact) {
      return ResultKit.failure({
        type: "bundle_not_found" as const,
        message: `cannot resolve '${idPath}': no artifact found at ${join(libraryRoot, idPath)}`,
      });
    }
    return ResultKit.success([artifact]);
  }

  return ResultKit.failure({
    type: "bundle_path_too_deep" as const,
    message: `cannot resolve '${idPath}': path too deep or unrecognized format`,
  });
}
