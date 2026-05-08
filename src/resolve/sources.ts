import { loadProfile, type ProfileResolveError } from "./profiles.ts";
import { expandBundle, type BundleResolveError } from "./bundles.ts";
import { resolveLocalIncludeEntry } from "./project.ts";
import { isProfileRef, isLocalRef } from "../util/paths.ts";
import type { Artifact } from "../artifact/types.ts";
import {
  ResultKit,
  type TypedError,
  type Result,
} from "../util/result-kit/index.ts";

export interface ResolveCtx {
  homeRoot: string;
  projectRoot: string | null;
}

export type SourceResolveError = TypedError<"source_project_context_missing">;

export type ResolveError =
  | ProfileResolveError
  | BundleResolveError
  | SourceResolveError;

/**
 * Resolve a list of manifest include entries into concrete Artifact descriptors.
 * Handles profile references (profile:<name>), bundle directories, and concrete paths.
 * Project-local paths (./) resolve from <projectRoot>/.agent-library.
 */
export async function resolveIncludes(
  entries: string[],
  ctx: ResolveCtx,
): Promise<Result<Artifact[], ResolveError>> {
  const out: Artifact[] = [];

  for (const entry of entries) {
    if (isProfileRef(entry)) {
      const profileName = entry.slice("profile:".length);
      const profileResult = await loadProfile(ctx.homeRoot, profileName);
      if (!profileResult.ok) return profileResult;
      const innerResult = await resolveIncludes(profileResult.value, ctx);
      if (!innerResult.ok) return innerResult;
      out.push(...innerResult.value);
    } else if (isLocalRef(entry)) {
      if (ctx.projectRoot === null) {
        return ResultKit.failure({
          type: "source_project_context_missing" as const,
          message: `cannot resolve '${entry}': project-local includes require a project root`,
        });
      }
      const localResult = resolveLocalIncludeEntry(
        ctx.projectRoot,
        entry as `./${string}`,
      );
      if (!localResult.ok) return localResult;
      out.push(...localResult.value);
    } else {
      const bundleResult = expandBundle(ctx.homeRoot, entry);
      if (!bundleResult.ok) return bundleResult;
      out.push(...bundleResult.value);
    }
  }

  return ResultKit.success(out);
}
