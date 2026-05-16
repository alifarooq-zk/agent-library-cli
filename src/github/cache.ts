import { existsSync, mkdirSync, rmSync } from "node:fs";
import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
import { defaultCacheRoot } from "../util/cache.ts";
import type { GitCacheError } from "./errors.ts";

export function cloneUrlFromRepo(repo: string): string {
  const override = process.env.AGENT_LIBRARY_INTERNAL_TEST_REPO_PATH;
  if (override) return override;
  return `https://github.com/${repo}.git`;
}

export function bareRepoCachePath(
  cloneUrl: string,
  cacheRoot = defaultCacheRoot(),
): string {
  const hash = new Bun.CryptoHasher("sha256").update(cloneUrl).digest("hex");
  return join(cacheRoot, "repos", `${hash}.git`);
}

export function treePath(sha: string, cacheRoot = defaultCacheRoot()): string {
  return join(cacheRoot, "trees", sha);
}

export async function fetchBareRepo(
  cloneUrl: string,
  cachePath: string,
): Promise<Result<void, GitCacheError>> {
  const alreadyCloned = existsSync(join(cachePath, "HEAD"));

  if (!alreadyCloned && existsSync(cachePath)) {
    return ResultKit.failure({
      type: "git_cache_corrupt",
      message: `cache path exists but is not a bare git repo: ${cachePath}`,
    });
  }

  if (!alreadyCloned) {
    mkdirSync(dirname(cachePath), { recursive: true });
  }

  const command = alreadyCloned
    ? Bun.$`git -C ${cachePath} fetch --prune origin`.quiet()
    : Bun.$`git clone --bare ${cloneUrl} ${cachePath}`.quiet();

  const result = await ResultKit.fromPromise(command, (cause) =>
    gitFetchError(cloneUrl, cause),
  );

  if (!result.ok) return result;
  return ResultKit.success(undefined);
}

export async function resolveRefSha(
  cachePath: string,
  ref: string,
): Promise<Result<string, GitCacheError>> {
  const rev = `${ref}^{commit}`;
  const proc = await Bun.$`git -C ${cachePath} rev-parse ${rev}`
    .quiet()
    .nothrow();

  if (proc.exitCode === 0) {
    return ResultKit.success(proc.stdout.toString().trim());
  }

  if (proc.exitCode === 128) {
    const stderr = proc.stderr.toString().trim();
    if (
      stderr.includes("unknown revision") ||
      stderr.includes("does not exist") ||
      stderr.includes("ambiguous argument")
    ) {
      return ResultKit.failure({
        type: "git_ref_not_found",
        message: `ref '${ref}' not found in ${cachePath}`,
      });
    }
    return ResultKit.failure({
      type: "git_cache_corrupt" as const,
      message: `git error resolving ref '${ref}' in ${cachePath}: ${stderr}`,
    });
  }

  return ResultKit.failure({
    type: "git_ref_not_found",
    message: `ref '${ref}' not found in ${cachePath}`,
  });
}

export async function hasCachedSha(
  cachePath: string,
  sha: string,
): Promise<Result<boolean, GitCacheError>> {
  const proc = await Bun.$`git -C ${cachePath} cat-file -e ${sha}`
    .quiet()
    .nothrow();
  if (proc.exitCode === 128) {
    const stderr = proc.stderr.toString().trim();
    return ResultKit.failure({
      type: "git_cache_corrupt" as const,
      message: `git infrastructure error checking sha in ${cachePath}: ${stderr}`,
    });
  }
  return ResultKit.success(proc.exitCode === 0);
}

export async function materializeTree(
  cachePath: string,
  sha: string,
  destPath: string,
): Promise<Result<void, GitCacheError>> {
  if (existsSync(destPath)) return ResultKit.success(undefined);

  const cachedResult = await hasCachedSha(cachePath, sha);
  if (!cachedResult.ok) return cachedResult;
  if (!cachedResult.value) {
    return ResultKit.failure({
      type: "git_sha_not_cached",
      message: `sha ${sha} is not cached in ${cachePath}`,
    });
  }

  const tmpPath = `${destPath}.tmp`;
  if (existsSync(tmpPath)) rmSync(tmpPath, { recursive: true, force: true });
  mkdirSync(tmpPath, { recursive: true });

  const extractResult = await ResultKit.fromPromise(
    Bun.$`git -C ${cachePath} archive ${sha} | tar -x -C ${tmpPath}`.quiet(),
    (cause) => ({
      type: "git_cache_corrupt" as const,
      message: `failed to materialize tree for sha ${sha} from ${cachePath}`,
      cause,
    }),
  );

  if (!extractResult.ok) {
    rmSync(tmpPath, { recursive: true, force: true });
    return extractResult;
  }

  const renameResult = await ResultKit.fromPromise(
    rename(tmpPath, destPath),
    (cause) => ({
      type: "git_cache_corrupt" as const,
      message: `failed to finalize tree for sha ${sha}: rename failed`,
      cause,
    }),
  );

  if (!renameResult.ok) {
    rmSync(tmpPath, { recursive: true, force: true });
    return renameResult;
  }

  return ResultKit.success(undefined);
}

function gitFetchError(cloneUrl: string, cause: unknown): GitCacheError {
  const message = errorText(cause);

  if (
    message.includes("Repository not found") ||
    message.includes("does not exist") ||
    message.includes("not found") ||
    message.includes("ERROR: Repository not found")
  ) {
    return {
      type: "git_repo_not_found",
      message: `repository not found: ${cloneUrl}`,
      cause,
    };
  }

  if (
    message.includes("Authentication failed") ||
    message.includes("Permission denied") ||
    message.includes("could not read Username")
  ) {
    return {
      type: "git_auth_failure",
      message: `authentication failed for ${cloneUrl}`,
      cause,
    };
  }

  return {
    type: "git_fetch_error",
    message: `failed to fetch ${cloneUrl}: ${message}`,
    cause,
  };
}

function errorText(cause: unknown): string {
  if (!cause || typeof cause !== "object") {
    return String(cause);
  }

  const candidate = cause as {
    message?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };

  return [candidate.message, candidate.stderr, candidate.stdout]
    .map((part) => {
      if (part instanceof Uint8Array) return new TextDecoder().decode(part);
      if (part === undefined || part === null) return "";
      return String(part);
    })
    .filter((part) => part.length > 0)
    .join("\n");
}
