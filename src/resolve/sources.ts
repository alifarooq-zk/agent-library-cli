import { loadProfile, type ProfileResolveError } from "./profiles.ts";
import { expandBundle, type BundleResolveError } from "./bundles.ts";
import { resolveLocalIncludeEntry } from "./project.ts";
import type { Artifact } from "../artifact/types.ts";
import {
  parseIncludeEntry,
  profileNameFromInclude,
  type LocalIncludeRef,
} from "../manifest/include.ts";
import {
  ResultKit,
  type TypedError,
  type Result,
} from "../util/result-kit/index.ts";

export interface HomeResolveCtx {
  readonly kind: "home";
  readonly homeRoot: string;
}

export interface ProjectResolveCtx {
  readonly kind: "project";
  readonly homeRoot: string;
  readonly projectRoot: string;
}

export type ResolveCtx = HomeResolveCtx | ProjectResolveCtx;

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
    const include = parseIncludeEntry(entry);

    if (include.kind === "profile") {
      const profileName = profileNameFromInclude(include.value);
      const profileResult = await loadProfile(ctx.homeRoot, profileName);
      if (!profileResult.ok) return profileResult;
      const innerResult = await resolveIncludes(profileResult.value, ctx);
      if (!innerResult.ok) return innerResult;
      out.push(...innerResult.value);
    } else if (include.kind === "local") {
      if (ctx.kind !== "project") {
        return ResultKit.failure({
          type: "source_project_context_missing" as const,
          message: `cannot resolve '${entry}': project-local includes require a project root`,
        });
      }
      const localResult = resolveLocalIncludeEntry(
        ctx.projectRoot,
        include.value as LocalIncludeRef,
      );
      if (!localResult.ok) return localResult;
      out.push(...localResult.value);
    } else {
      const bundleResult = expandBundle(ctx.homeRoot, include.value);
      if (!bundleResult.ok) return bundleResult;
      out.push(...bundleResult.value);
    }
  }

  return ResultKit.success(out);
}
