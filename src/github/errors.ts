import type { TypedErrorUnion } from "../util/result-kit/index.ts";

export type GitCacheErrorType =
  | "git_auth_failure"
  | "git_repo_not_found"
  | "git_ref_not_found"
  | "git_fetch_error"
  | "git_cache_corrupt"
  | "git_sha_not_cached";

export type GitCacheError = TypedErrorUnion<GitCacheErrorType>;
