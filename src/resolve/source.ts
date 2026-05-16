import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cloneUrlFromRepo,
  bareRepoCachePath,
  treePath,
  fetchBareRepo,
  resolveRefSha,
  materializeTree,
  hasCachedSha,
} from "../github/cache.ts";
import type { GitCacheError } from "../github/errors.ts";
import { readLockfile, type LockfileReadError } from "../lockfile/read.ts";
import type { LockfileSource } from "../lockfile/schema.ts";
import type { ManifestSource } from "../manifest/schema.ts";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
import { defaultCacheRoot } from "../util/cache.ts";

export interface SourceContext {
  readonly homeRoot: string;
  readonly source: LockfileSource;
}

export type SourceResolveError = GitCacheError | LockfileReadError;

export async function resolveSource(
  manifestSource: ManifestSource,
  lockfilePath: string,
  opts: { update: boolean },
  cacheRoot = defaultCacheRoot(),
): Promise<Result<SourceContext, SourceResolveError>> {
  const cloneUrl = cloneUrlFromRepo(manifestSource.repo);
  const cachePath = bareRepoCachePath(cloneUrl, cacheRoot);

  if (!opts.update) {
    const lockResult = await readLockfile(lockfilePath);
    if (!lockResult.ok) return lockResult;

    const lockedSource = lockResult.value?.source;
    if (lockedSource) {
      return resolveLockedSource(lockedSource, cachePath, cacheRoot);
    }
  }

  const fetchResult = await fetchBareRepo(cloneUrl, cachePath);
  if (!fetchResult.ok) return fetchResult;

  const shaResult = await resolveRefSha(cachePath, manifestSource.ref);
  if (!shaResult.ok) return shaResult;

  const sha = shaResult.value;
  const homeRoot = treePath(sha, cacheRoot);
  const materializeResult = await materializeTree(cachePath, sha, homeRoot);
  if (!materializeResult.ok) return materializeResult;

  return ResultKit.success({
    homeRoot,
    source: {
      repo: manifestSource.repo,
      sha,
      ref: manifestSource.ref,
      fetchedAt: new Date().toISOString(),
    },
  });
}

async function resolveLockedSource(
  source: LockfileSource,
  cachePath: string,
  cacheRoot: string,
): Promise<Result<SourceContext, SourceResolveError>> {
  const pinnedSha = source.sha;

  // If the bare repo hasn't been cloned yet, the SHA obviously isn't available.
  if (!existsSync(join(cachePath, "HEAD"))) {
    return ResultKit.failure({
      type: "git_sha_not_cached",
      message: `locked SHA ${pinnedSha} is not available locally; run sync --update to fetch from remote`,
    });
  }

  const cachedResult = await hasCachedSha(cachePath, pinnedSha);
  if (!cachedResult.ok) return cachedResult;
  if (!cachedResult.value) {
    return ResultKit.failure({
      type: "git_sha_not_cached",
      message: `locked SHA ${pinnedSha} is not available locally; run sync --update to fetch from remote`,
    });
  }

  const homeRoot = treePath(pinnedSha, cacheRoot);
  const materializeResult = await materializeTree(
    cachePath,
    pinnedSha,
    homeRoot,
  );
  if (!materializeResult.ok) return materializeResult;

  return ResultKit.success({
    homeRoot,
    source,
  });
}
