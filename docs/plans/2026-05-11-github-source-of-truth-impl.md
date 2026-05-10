# GitHub Source of Truth Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Use the `subagent-driven-development` skill for concurrent dispatch of independent tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `~/.agent-library` home root with a GitHub-backed bare-repo cache, pin syncs to an exact commit SHA in the lockfile, and add explicit `sync --update` and `cache prune` commands.

**Architecture:** A new `resolveSource` pipeline phase runs before `resolveIncludes` and resolves a `homeRoot` string from either a pinned lockfile SHA (offline, no fetch) or a fresh remote fetch. All downstream phases remain path-agnostic. The bare-repo cache lives at `~/.cache/agent-library/repos/<sha256-of-clone-url>.git`; extracted trees at `~/.cache/agent-library/trees/<sha>/`.

**Tech Stack:** Bun, TypeScript, Zod, ResultKit (`src/util/result-kit/`), `Bun.$` for git subprocess calls, `node:os` for `homedir()`, `Bun.CryptoHasher` for SHA-256 clone-URL hashing.

**Assumptions:**
- `source` is optional in the Zod schema to preserve backward compatibility with existing test fixtures that use `HOME_AGENT_LIBRARY`. The CLI documentation treats it as required for production. When absent, `homeRoot` falls back to `--home` / `HOME_AGENT_LIBRARY` (existing behavior). When present, `resolveSource` owns `homeRoot`.
- Lockfile `source` block is optional — only written when the manifest has a `source` block.
- `AGENT_LIBRARY_TEST_REPO_PATH` env var overrides the derived clone URL for unit/integration testing with local bare repos.

---

## File Structure

**Create:**
| Path | Purpose |
|---|---|
| `src/github/errors.ts` | Typed error union for all git/cache operations |
| `src/github/cache.ts` | Bare-repo fetch, ref resolution, tree materialization |
| `src/resolve/source.ts` | `resolveSource()` — new pipeline phase |
| `src/cache/registry.ts` | Read/write `~/.cache/agent-library/projects.json` |
| `src/commands/cache.ts` | `cache prune` sub-command |
| `tests/helpers/test-bare-repo.ts` | Creates a temporary bare repo from a fixture dir |
| `tests/unit/github-cache.test.ts` | Unit tests for `src/github/cache.ts` |
| `tests/unit/resolve-source.test.ts` | Unit tests for `src/resolve/source.ts` |
| `tests/unit/cache-registry.test.ts` | Unit tests for `src/cache/registry.ts` |
| `tests/integration/sync-github-source.test.ts` | Integration: first-time sync, re-sync, update, cache-miss |
| `tests/integration/cache-prune.test.ts` | Integration: `cache prune` removes only unreferenced trees |

**Modify:**
| Path | Change |
|---|---|
| `src/lockfile/schema.ts` | Change `version: 2` → `version: 1`; add optional `source` block |
| `src/lockfile/read.ts` | Reject v2 (was: reject v1), accept v1; remove old v1 rejection message |
| `src/manifest/schema.ts` | Add optional `source` block with `type: "github"`, `repo`, `ref` |
| `src/sync/plan.ts` | Add optional `source` to `SyncPlan`; update `buildPlan` signature |
| `src/sync/lockfile.ts` | Embed `plan.source` in lockfile when present; write `version: 1` |
| `src/commands/sync.ts` | Add `--update` flag; call `resolveSource` when manifest has `source`; write registry entry; thread `source` into `buildPlan` |
| `src/cli.ts` | Register `cacheCommand` |
| `tests/integration/sync-lockfile.test.ts` | Update `version: 2` assertions to `version: 1` |

---

### Task 1: Lockfile v1 Schema Reset

**Files:**
- Modify: `src/lockfile/schema.ts`
- Modify: `src/lockfile/read.ts`
- Modify (assertions only): `tests/integration/sync-lockfile.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/integration/sync-lockfile.test.ts`, change the existing `"lockfile has correct cliVersion and artifact count"` assertion:

```typescript
// Change this line:
expect(lockfile.version).toBe(2);
// To:
expect(lockfile.version).toBe(1);
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/integration/sync-lockfile.test.ts --test-name-pattern "lockfile has correct cliVersion"
```

Expected: FAIL — `Expected: 1, Received: 2`

- [ ] **Step 3: Update lockfile schema**

Replace the entire body of `src/lockfile/schema.ts`:

```typescript
import { z } from "zod";

export const LockfileAdapterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("applied"),
    source: z.string(),
    hash: z.string(),
  }),
]);

export const LockfileSourceSchema = z.object({
  repo: z.string(),
  sha: z.string().regex(/^[0-9a-f]{40}$/, "sha must be a 40-character lowercase hex SHA-1"),
  ref: z.string(),
  fetchedAt: z.iso.datetime({ message: "fetchedAt must be an ISO 8601 datetime string" }),
});

export const LockfileSchema = z.object({
  version: z.literal(1),
  cliVersion: z.string(),
  mode: z.enum(["generated", "vendored"]),
  target: z.enum(["codex", "claude", "both"]),
  syncedAt: z.iso.datetime({ message: "syncedAt must be an ISO 8601 datetime string" }),
  source: LockfileSourceSchema.optional(),
  include: z.array(z.string()),
  artifacts: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["skill", "command", "agent"]),
      files: z.array(
        z.object({
          source: z.string(),
          sourceHash: z.string().regex(
            /^[0-9a-f]{64}$/,
            "sourceHash must be a 64-character lowercase hex SHA-256 digest",
          ),
          targets: z.array(
            z.object({
              path: z.string(),
              targetHash: z.string().regex(
                /^[0-9a-f]{64}$/,
                "targetHash must be a 64-character lowercase hex SHA-256 digest",
              ),
              adapter: LockfileAdapterSchema,
            }),
          ),
        }),
      ),
    }),
  ),
});

export type Lockfile = z.infer<typeof LockfileSchema>;
export type LockfileSource = z.infer<typeof LockfileSourceSchema>;
```

- [ ] **Step 4: Update `read.ts` — swap version rejection**

In `src/lockfile/read.ts`, replace the v1-rejection block (lines 49–57):

```typescript
// OLD — remove this entire block:
if (
  rawResult.value &&
  typeof rawResult.value === "object" &&
  "version" in rawResult.value &&
  rawResult.value.version === 1
) {
  return ResultKit.failure({
    type: "lockfile_schema_error" as const,
    message:
      "lockfile version 1 is no longer supported; delete .agent-library.lock and run sync to regenerate",
  });
}
```

Replace with:

```typescript
if (
  rawResult.value &&
  typeof rawResult.value === "object" &&
  "version" in rawResult.value &&
  rawResult.value.version === 2
) {
  return ResultKit.failure({
    type: "lockfile_schema_error" as const,
    message:
      "lockfile version 2 is no longer supported; delete .agent-library.lock and run sync to regenerate",
  });
}
```

- [ ] **Step 5: Update `lockfile.ts` — write version 1**

In `src/sync/lockfile.ts` at line 124, change `version: 2` to `version: 1 as const`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test tests/integration/sync-lockfile.test.ts
```

Expected: PASS for all tests in file.

- [ ] **Step 7: Commit**

```bash
git add src/lockfile/schema.ts src/lockfile/read.ts src/sync/lockfile.ts tests/integration/sync-lockfile.test.ts
git commit -m "feat(lockfile): reset schema to v1, add optional source block"
```

---

### Task 2: Manifest `source` Block

**Files:**
- Modify: `src/manifest/schema.ts`
- Test: `tests/fixtures/manifests/valid.yml` (add source block for completeness)

- [ ] **Step 1: Write the failing test**

Create a new inline test at the bottom of an existing manifest test file, or use `bun:test` directly. Add to `tests/unit/` a new file `tests/unit/manifest-source.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { ManifestSchema } from "../../src/manifest/schema.ts";

describe("ManifestSchema source block", () => {
  it("parses a manifest with a valid source block", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/foo"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source?.type).toBe("github");
      expect(result.data.source?.repo).toBe("org/repo");
      expect(result.data.source?.ref).toBe("main");
    }
  });

  it("parses a manifest without source (backward compat)", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/foo"],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source).toBeUndefined();
  });

  it("rejects source.type other than github", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/foo"],
      source: { type: "local", repo: "org/repo", ref: "main" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects source with missing ref", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/foo"],
      source: { type: "github", repo: "org/repo" },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/unit/manifest-source.test.ts
```

Expected: FAIL — `source` field unknown / parse failures on test cases that expect `source` to work.

- [ ] **Step 3: Add source block to manifest schema**

Replace the entire body of `src/manifest/schema.ts`:

```typescript
import { z } from "zod";

export const ManifestSourceSchema = z.object({
  type: z.literal("github"),
  repo: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, "repo must be in org/name format"),
  ref: z.string().min(1, "ref is required"),
});

export const ManifestSchema = z.object({
  version: z.literal(1, { error: "version is required and must be 1" }),
  scope: z.enum(["home", "project"]).default("project"),
  mode: z.enum(["generated", "vendored"]),
  target: z.enum(["codex", "claude", "both"]),
  include: z
    .array(z.string())
    .min(1, { error: "include must have at least one entry" }),
  source: ManifestSourceSchema.optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestInput = z.input<typeof ManifestSchema>;
export type ManifestSource = z.infer<typeof ManifestSourceSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/manifest-source.test.ts
```

Expected: PASS for all 4 tests.

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
bun test
```

Expected: all existing tests PASS (existing fixtures have no `source` block; schema accepts absent source).

- [ ] **Step 6: Commit**

```bash
git add src/manifest/schema.ts tests/unit/manifest-source.test.ts
git commit -m "feat(manifest): add optional source block for github source type"
```

---

### Task 3: GitHub Bare-Repo Cache Module

**Files:**
- Create: `src/github/errors.ts`
- Create: `src/github/cache.ts`
- Create: `tests/helpers/test-bare-repo.ts`
- Create: `tests/unit/github-cache.test.ts`

- [ ] **Step 1: Create typed error types**

Create `src/github/errors.ts`:

```typescript
import type { TypedErrorUnion } from "../util/result-kit/index.ts";

export type GitCacheErrorType =
  | "git_auth_failure"
  | "git_repo_not_found"
  | "git_ref_not_found"
  | "git_fetch_timeout"
  | "git_cache_corrupt"
  | "git_sha_not_cached";

export type GitCacheError = TypedErrorUnion<GitCacheErrorType>;
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/github-cache.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cloneUrlFromRepo,
  bareRepoCachePath,
  treePath,
  fetchBareRepo,
  resolveRefSha,
  materializeTree,
  hasCachedSha,
} from "../../src/github/cache.ts";

const CACHE_DIR = mkdtempSync(join(tmpdir(), "al-cache-"));
let BARE_REPO: string;
let COMMIT_SHA: string;

beforeAll(async () => {
  // Create a local bare repo to act as the remote
  const work = mkdtempSync(join(tmpdir(), "al-work-"));
  await Bun.$`git -C ${work} init --initial-branch main`.quiet();
  await Bun.$`git -C ${work} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${work} config user.name "Test"`.quiet();
  await Bun.write(join(work, "README.md"), "hello");
  await Bun.$`git -C ${work} add README.md`.quiet();
  await Bun.$`git -C ${work} commit -m "init"`.quiet();
  COMMIT_SHA = (await Bun.$`git -C ${work} rev-parse HEAD`.text()).trim();
  BARE_REPO = `${work}-bare.git`;
  await Bun.$`git clone --bare ${work} ${BARE_REPO}`.quiet();
  rmSync(work, { recursive: true });
});

afterAll(() => {
  rmSync(CACHE_DIR, { recursive: true, force: true });
  rmSync(BARE_REPO, { recursive: true, force: true });
});

describe("cloneUrlFromRepo", () => {
  it("derives https github url from org/name", () => {
    expect(cloneUrlFromRepo("org/repo")).toBe("https://github.com/org/repo.git");
  });

  it("uses AGENT_LIBRARY_TEST_REPO_PATH override when set", () => {
    process.env.AGENT_LIBRARY_TEST_REPO_PATH = "/tmp/test.git";
    expect(cloneUrlFromRepo("org/repo")).toBe("/tmp/test.git");
    delete process.env.AGENT_LIBRARY_TEST_REPO_PATH;
  });
});

describe("bareRepoCachePath", () => {
  it("returns a deterministic path based on sha256 of url", () => {
    const p1 = bareRepoCachePath("https://github.com/org/repo.git", CACHE_DIR);
    const p2 = bareRepoCachePath("https://github.com/org/repo.git", CACHE_DIR);
    expect(p1).toBe(p2);
    expect(p1).toMatch(/\.git$/);
  });

  it("returns different paths for different urls", () => {
    const p1 = bareRepoCachePath("https://github.com/org/a.git", CACHE_DIR);
    const p2 = bareRepoCachePath("https://github.com/org/b.git", CACHE_DIR);
    expect(p1).not.toBe(p2);
  });
});

describe("fetchBareRepo", () => {
  it("clones a bare repo from a local path", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await fetchBareRepo(BARE_REPO, cachePath);
    expect(result.ok).toBe(true);
    const exists = await Bun.file(join(cachePath, "HEAD")).exists();
    expect(exists).toBe(true);
  });

  it("fetches into existing bare repo (no error)", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await fetchBareRepo(BARE_REPO, cachePath);
    expect(result.ok).toBe(true);
  });

  it("returns git_repo_not_found for a non-existent path", async () => {
    const result = await fetchBareRepo("/nonexistent/repo.git", join(CACHE_DIR, "fail.git"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("git_repo_not_found");
  });
});

describe("resolveRefSha", () => {
  it("resolves main ref to commit sha", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await resolveRefSha(cachePath, "main");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(COMMIT_SHA);
  });

  it("returns git_ref_not_found for unknown ref", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await resolveRefSha(cachePath, "nonexistent-branch");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("git_ref_not_found");
  });
});

describe("materializeTree", () => {
  it("extracts tree for known sha", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const dest = treePath(COMMIT_SHA, CACHE_DIR);
    const result = await materializeTree(cachePath, COMMIT_SHA, dest);
    expect(result.ok).toBe(true);
    const readmeExists = await Bun.file(join(dest, "README.md")).exists();
    expect(readmeExists).toBe(true);
  });

  it("is idempotent — skips extraction if dest already exists", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const dest = treePath(COMMIT_SHA, CACHE_DIR);
    const result = await materializeTree(cachePath, COMMIT_SHA, dest);
    expect(result.ok).toBe(true);
  });
});

describe("hasCachedSha", () => {
  it("returns true for a sha present in the bare repo", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await hasCachedSha(cachePath, COMMIT_SHA);
    expect(result).toBe(true);
  });

  it("returns false for an unknown sha", async () => {
    const cachePath = join(CACHE_DIR, "fetch-test.git");
    const result = await hasCachedSha(cachePath, "a".repeat(40));
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
bun test tests/unit/github-cache.test.ts
```

Expected: FAIL — module `src/github/cache.ts` does not exist.

- [ ] **Step 4: Implement `src/github/cache.ts`**

```typescript
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { rename } from "node:fs/promises";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
import type { GitCacheError } from "./errors.ts";

const DEFAULT_CACHE_ROOT = join(homedir(), ".cache", "agent-library");

export function cloneUrlFromRepo(repo: string): string {
  const override = process.env.AGENT_LIBRARY_TEST_REPO_PATH;
  if (override) return override;
  return `https://github.com/${repo}.git`;
}

export function bareRepoCachePath(cloneUrl: string, cacheRoot = DEFAULT_CACHE_ROOT): string {
  const hash = new Bun.CryptoHasher("sha256").update(cloneUrl).digest("hex");
  return join(cacheRoot, "repos", `${hash}.git`);
}

export function treePath(sha: string, cacheRoot = DEFAULT_CACHE_ROOT): string {
  return join(cacheRoot, "trees", sha);
}

export async function fetchBareRepo(
  cloneUrl: string,
  cachePath: string,
): Promise<Result<void, GitCacheError>> {
  const alreadyCloned = existsSync(join(cachePath, "HEAD"));
  const cmd = alreadyCloned
    ? Bun.$`git -C ${cachePath} fetch --prune origin`.quiet()
    : (mkdirSync(join(cachePath, ".."), { recursive: true }),
       Bun.$`git clone --bare ${cloneUrl} ${cachePath}`.quiet());

  const proc = await ResultKit.fromPromise(cmd, (cause) => {
    const msg = cause instanceof Error ? cause.message : String(cause);
    const isNotFound =
      msg.includes("Repository not found") ||
      msg.includes("does not exist") ||
      msg.includes("not found") ||
      msg.includes("ERROR: Repository not found");
    return {
      type: (isNotFound ? "git_repo_not_found" : "git_fetch_timeout") as GitCacheError["type"],
      message: isNotFound
        ? `repository not found: ${cloneUrl}`
        : `failed to fetch ${cloneUrl}: ${msg}`,
      cause,
    };
  });
  if (!proc.ok) return proc;
  return ResultKit.success(undefined);
}

export async function resolveRefSha(
  cachePath: string,
  ref: string,
): Promise<Result<string, GitCacheError>> {
  const proc = await Bun.$`git -C ${cachePath} rev-parse "${ref}^{commit}"`.quiet().nothrow();
  if (proc.exitCode === 0) return ResultKit.success(proc.stdout.toString().trim());
  return ResultKit.failure({
    type: "git_ref_not_found" as const,
    message: `ref '${ref}' not found in ${cachePath}`,
  });
}

export async function hasCachedSha(cachePath: string, sha: string): Promise<boolean> {
  const proc = await Bun.$`git -C ${cachePath} cat-file -e ${sha}^{commit}`.quiet().nothrow();
  return proc.exitCode === 0;
}

export async function materializeTree(
  cachePath: string,
  sha: string,
  destPath: string,
): Promise<Result<void, GitCacheError>> {
  if (existsSync(destPath)) return ResultKit.success(undefined);

  const tmp = `${destPath}.tmp`;
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const extract = await ResultKit.fromPromise(
    Bun.$`git -C ${cachePath} archive ${sha} | tar -x -C ${tmp}`.quiet(),
    (cause) => ({
      type: "git_cache_corrupt" as const,
      message: `failed to materialize tree for sha ${sha} from ${cachePath}`,
      cause,
    }),
  );
  if (!extract.ok) {
    rmSync(tmp, { recursive: true, force: true });
    return extract;
  }

  const renameResult = await ResultKit.fromPromise(
    rename(tmp, destPath),
    (cause) => ({
      type: "git_cache_corrupt" as const,
      message: `failed to finalize tree for sha ${sha}: rename failed`,
      cause,
    }),
  );
  if (!renameResult.ok) {
    rmSync(tmp, { recursive: true, force: true });
    return renameResult;
  }

  return ResultKit.success(undefined);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/unit/github-cache.test.ts
```

Expected: PASS for all tests in file.

- [ ] **Step 6: Create test bare-repo helper**

Create `tests/helpers/test-bare-repo.ts`:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestBareRepo {
  bareRepoPath: string;
  commitSha: string;
  cleanup: () => void;
}

export async function createTestBareRepo(sourceDir: string): Promise<TestBareRepo> {
  const work = mkdtempSync(join(tmpdir(), "al-work-"));
  await Bun.$`git -C ${work} init --initial-branch main`.quiet();
  await Bun.$`git -C ${work} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${work} config user.name "Test"`.quiet();
  await Bun.$`cp -r ${sourceDir}/. ${work}`.quiet();
  await Bun.$`git -C ${work} add -A`.quiet();
  await Bun.$`git -C ${work} commit -m "init"`.quiet();
  const commitSha = (await Bun.$`git -C ${work} rev-parse HEAD`.text()).trim();
  const bareRepoPath = `${work}-bare.git`;
  await Bun.$`git clone --bare ${work} ${bareRepoPath}`.quiet();
  rmSync(work, { recursive: true });
  return {
    bareRepoPath,
    commitSha,
    cleanup: () => rmSync(bareRepoPath, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/github/errors.ts src/github/cache.ts tests/helpers/test-bare-repo.ts tests/unit/github-cache.test.ts
git commit -m "feat(github): add bare-repo cache module with fetch, resolve, and materialize"
```

---

### Task 4: `resolveSource` Pipeline Phase

**Depends on:** Task 1 (lockfile schema), Task 2 (manifest schema), Task 3 (github cache)

**Files:**
- Create: `src/resolve/source.ts`
- Create: `tests/unit/resolve-source.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/resolve-source.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { resolveSource } from "../../src/resolve/source.ts";
import { createTestBareRepo, type TestBareRepo } from "../helpers/test-bare-repo.ts";

const HOME = "tests/fixtures/home-min";
let repo: TestBareRepo;
let cacheDir: string;
let projectDir: string;

beforeAll(async () => {
  repo = await createTestBareRepo(HOME);
  process.env.AGENT_LIBRARY_TEST_REPO_PATH = repo.bareRepoPath;
});

afterAll(() => {
  repo.cleanup();
  delete process.env.AGENT_LIBRARY_TEST_REPO_PATH;
});

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "al-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "al-project-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

const manifest = {
  version: 1 as const,
  mode: "generated" as const,
  target: "claude" as const,
  scope: "project" as const,
  include: ["global/skills/writing-plans"],
  source: { type: "github" as const, repo: "org/repo", ref: "main" },
};

describe("resolveSource — no lockfile (first-time sync)", () => {
  it("fetches bare repo, materializes tree, returns homeRoot", async () => {
    const result = await resolveSource(manifest, join(projectDir, ".agent-library.lock"), { update: false }, cacheDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.homeRoot).toContain("trees");
      expect(result.value.source.sha).toBe(repo.commitSha);
      expect(result.value.source.repo).toBe("org/repo");
      expect(result.value.source.ref).toBe("main");
    }
  });
});

describe("resolveSource — lockfile present, SHA in cache", () => {
  it("returns tree path without fetching", async () => {
    // First sync to populate cache
    const first = await resolveSource(manifest, projectDir, join(projectDir, ".agent-library.lock"), { update: false }, cacheDir);
    expect(first.ok).toBe(true);

    // Write a lockfile with the known SHA
    const lockfilePath = join(projectDir, ".agent-library.lock");
    writeFileSync(lockfilePath, stringify({
      version: 1,
      cliVersion: "0.1.0",
      mode: "generated",
      target: "claude",
      syncedAt: new Date().toISOString(),
      source: { repo: "org/repo", sha: repo.commitSha, ref: "main", fetchedAt: new Date().toISOString() },
      include: ["global/skills/writing-plans"],
      artifacts: [],
    }));

    const second = await resolveSource(manifest, lockfilePath, { update: false }, cacheDir);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.source.sha).toBe(repo.commitSha);
  });
});

describe("resolveSource — lockfile present, SHA NOT in cache (cache miss)", () => {
  it("returns git_sha_not_cached error", async () => {
    const lockfilePath = join(projectDir, ".agent-library.lock");
    const fakeSha = "a".repeat(40);
    writeFileSync(lockfilePath, stringify({
      version: 1,
      cliVersion: "0.1.0",
      mode: "generated",
      target: "claude",
      syncedAt: new Date().toISOString(),
      source: { repo: "org/repo", sha: fakeSha, ref: "main", fetchedAt: new Date().toISOString() },
      include: ["global/skills/writing-plans"],
      artifacts: [],
    }));
    const result = await resolveSource(manifest, lockfilePath, { update: false }, cacheDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("git_sha_not_cached");
      expect(result.error.message).toContain(fakeSha);
      expect(result.error.message).toContain("sync --update");
      expect(result.error.message).toContain("fetch from remote");
    }
  });
});

describe("resolveSource — update mode", () => {
  it("fetches and resolves latest SHA regardless of lockfile", async () => {
    const result = await resolveSource(manifest, join(projectDir, ".agent-library.lock"), { update: true }, cacheDir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.source.sha).toBe(repo.commitSha);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/unit/resolve-source.test.ts
```

Expected: FAIL — module `src/resolve/source.ts` does not exist.

- [ ] **Step 3: Implement `src/resolve/source.ts`**

```typescript
import { join } from "node:path";
import { homedir } from "node:os";
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
import { readLockfile } from "../lockfile/read.ts";
import type { LockfileReadError } from "../lockfile/read.ts";
import type { LockfileSource } from "../lockfile/schema.ts";
import type { ManifestSource } from "../manifest/schema.ts";
import { ResultKit, type Result } from "../util/result-kit/index.ts";
import type { TypedError } from "../util/result-kit/index.ts";

function defaultCacheRoot(): string {
  return process.env.AGENT_LIBRARY_CACHE_DIR ?? join(homedir(), ".cache", "agent-library");
}

export interface SourceContext {
  readonly homeRoot: string;
  readonly source: LockfileSource;
}

export type SourceResolveError =
  | GitCacheError
  | LockfileReadError
  | TypedError<"git_sha_not_cached">;

export async function resolveSource(
  manifestSource: ManifestSource,
  lockfilePath: string,
  opts: { update: boolean },
  cacheRoot = defaultCacheRoot(),
): Promise<Result<SourceContext, SourceResolveError>> {
  const cloneUrl = cloneUrlFromRepo(manifestSource.repo);
  const cachePath = bareRepoCachePath(cloneUrl, cacheRoot);

  if (!opts.update) {
    // Check lockfile for pinned SHA
    const lockResult = await readLockfile(lockfilePath);
    if (!lockResult.ok) return lockResult;

    if (lockResult.value !== null && lockResult.value.source) {
      const pinnedSha = lockResult.value.source.sha;
      const inCache = await hasCachedSha(cachePath, pinnedSha);
      if (!inCache) {
        return ResultKit.failure({
          type: "git_sha_not_cached" as const,
          message: `locked SHA \`${pinnedSha}\` is not available locally — run \`sync --update\` to fetch from remote`,
        });
      }
      const dest = treePath(pinnedSha, cacheRoot);
      const materialize = await materializeTree(cachePath, pinnedSha, dest);
      if (!materialize.ok) return materialize;
      return ResultKit.success({
        homeRoot: dest,
        source: lockResult.value.source,
      });
    }
  }

  // No lockfile, or --update: fetch remote and resolve SHA
  const fetchResult = await fetchBareRepo(cloneUrl, cachePath);
  if (!fetchResult.ok) return fetchResult;

  const shaResult = await resolveRefSha(cachePath, manifestSource.ref);
  if (!shaResult.ok) return shaResult;
  const sha = shaResult.value;

  const dest = treePath(sha, cacheRoot);
  const materialize = await materializeTree(cachePath, sha, dest);
  if (!materialize.ok) return materialize;

  return ResultKit.success({
    homeRoot: dest,
    source: {
      repo: manifestSource.repo,
      sha,
      ref: manifestSource.ref,
      fetchedAt: new Date().toISOString(),
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/resolve-source.test.ts
```

Expected: PASS for all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/resolve/source.ts tests/unit/resolve-source.test.ts
git commit -m "feat(resolve): add resolveSource pipeline phase for github-backed homeRoot"
```

---

### Task 5: Project Registry

**Files:**
- Create: `src/cache/registry.ts`
- Create: `tests/unit/cache-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cache-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegistry, upsertProjectEntry } from "../../src/cache/registry.ts";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "al-reg-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const registryPath = () => join(dir, "projects.json");

describe("readRegistry", () => {
  it("returns empty projects array when file does not exist", async () => {
    const result = await readRegistry(registryPath());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.projects).toEqual([]);
  });
});

describe("upsertProjectEntry", () => {
  it("creates the registry file and adds the first entry", async () => {
    const entry = {
      path: "/home/user/project-a",
      repo: "org/repo",
      ref: "main",
      sha: "a".repeat(40),
      lastSyncedAt: "2026-05-11T00:00:00.000Z",
    };
    const writeResult = await upsertProjectEntry(registryPath(), entry);
    expect(writeResult.ok).toBe(true);

    const readResult = await readRegistry(registryPath());
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.projects).toHaveLength(1);
      expect(readResult.value.projects[0]!.path).toBe("/home/user/project-a");
    }
  });

  it("updates an existing entry in-place (same path, new sha)", async () => {
    const base = {
      path: "/home/user/project-a",
      repo: "org/repo",
      ref: "main",
      sha: "a".repeat(40),
      lastSyncedAt: "2026-05-11T00:00:00.000Z",
    };
    await upsertProjectEntry(registryPath(), base);
    await upsertProjectEntry(registryPath(), { ...base, sha: "b".repeat(40) });

    const readResult = await readRegistry(registryPath());
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.projects).toHaveLength(1);
      expect(readResult.value.projects[0]!.sha).toBe("b".repeat(40));
    }
  });

  it("appends a second entry for a different project path", async () => {
    await upsertProjectEntry(registryPath(), {
      path: "/home/user/project-a", repo: "org/repo", ref: "main",
      sha: "a".repeat(40), lastSyncedAt: "2026-05-11T00:00:00.000Z",
    });
    await upsertProjectEntry(registryPath(), {
      path: "/home/user/project-b", repo: "org/repo", ref: "main",
      sha: "b".repeat(40), lastSyncedAt: "2026-05-11T00:00:00.000Z",
    });

    const readResult = await readRegistry(registryPath());
    expect(readResult.ok).toBe(true);
    if (readResult.ok) expect(readResult.value.projects).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/unit/cache-registry.test.ts
```

Expected: FAIL — module `src/cache/registry.ts` does not exist.

- [ ] **Step 3: Implement `src/cache/registry.ts`**

```typescript
import { join } from "node:path";
import { homedir } from "node:os";
import { writeFileAtomic } from "../util/fs.ts";
import { ResultKit, type Result, type TypedError } from "../util/result-kit/index.ts";

function defaultRegistryPath(): string {
  const cacheRoot = process.env.AGENT_LIBRARY_CACHE_DIR ?? join(homedir(), ".cache", "agent-library");
  return join(cacheRoot, "projects.json");
}

export interface ProjectEntry {
  readonly path: string;
  readonly repo: string;
  readonly ref: string;
  readonly sha: string;
  readonly lastSyncedAt: string;
}

export interface Registry {
  readonly projects: ProjectEntry[];
}

export type RegistryError = TypedError<"registry_read_error" | "registry_write_error">;

export async function readRegistry(
  registryPath = defaultRegistryPath(),
): Promise<Result<Registry, RegistryError>> {
  const file = Bun.file(registryPath);
  const exists = await ResultKit.fromPromise(file.exists(), (cause) => ({
    type: "registry_read_error" as const,
    message: `cannot stat registry at ${registryPath}`,
    cause,
  }));
  if (!exists.ok) return exists;
  if (!exists.value) return ResultKit.success({ projects: [] });

  const text = await ResultKit.fromPromise(file.text(), (cause) => ({
    type: "registry_read_error" as const,
    message: `cannot read registry at ${registryPath}`,
    cause,
  }));
  if (!text.ok) return text;

  const parsed = ResultKit.fromThrowable(
    (t: string) => JSON.parse(t) as Registry,
    (cause) => ({
      type: "registry_read_error" as const,
      message: `registry at ${registryPath} contains invalid JSON`,
      cause,
    }),
  )(text.value);
  return parsed;
}

export async function upsertProjectEntry(
  registryPath = defaultRegistryPath(),
  entry: ProjectEntry,
): Promise<Result<void, RegistryError>> {
  const read = await readRegistry(registryPath);
  if (!read.ok) return read;

  const projects = read.value.projects.filter((p) => p.path !== entry.path);
  projects.push(entry);

  return ResultKit.fromPromise(
    writeFileAtomic(registryPath, JSON.stringify({ projects }, null, 2)),
    (cause) => ({
      type: "registry_write_error" as const,
      message: `cannot write registry at ${registryPath}`,
      cause,
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/cache-registry.test.ts
```

Expected: PASS for all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cache/registry.ts tests/unit/cache-registry.test.ts
git commit -m "feat(cache): add project registry for tracking synced projects"
```

---

### Task 6: Wire Sync Command + SyncPlan Source

**Depends on:** Tasks 1–5

**Files:**
- Modify: `src/sync/plan.ts`
- Modify: `src/sync/lockfile.ts`
- Modify: `src/commands/sync.ts`
- Create: `tests/integration/sync-github-source.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/sync-github-source.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readLockfile } from "../../src/lockfile/read.ts";
import { createTestBareRepo, type TestBareRepo } from "../helpers/test-bare-repo.ts";

const FIXTURE = "tests/fixtures/projects/p1-skill-only";
let repo: TestBareRepo;
let cacheDir: string;
let projectDir: string;

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: {
      ...process.env,
      AGENT_LIBRARY_TEST_REPO_PATH: repo.bareRepoPath,
      AGENT_LIBRARY_CACHE_DIR: cacheDir,
    },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

beforeAll(async () => {
  repo = await createTestBareRepo("tests/fixtures/home-min");
});

afterAll(() => repo.cleanup());

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "al-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "al-sync-github-"));
  cpSync(FIXTURE, projectDir, { recursive: true });
  // Overwrite the manifest to include source block
  Bun.write(
    join(projectDir, ".agent-library.yml"),
    stringify({
      version: 1,
      mode: "generated",
      target: "claude",
      include: ["global/skills/writing-plans"],
      source: { type: "github", repo: "org/repo", ref: "main" },
    }),
  );
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

it("first-time sync from github source succeeds and writes lockfile with source block", async () => {
  const r = run(["sync", projectDir]);
  expect(r.code).toBe(0);

  const lockResult = await readLockfile(join(projectDir, ".agent-library.lock"));
  expect(lockResult.ok).toBe(true);
  if (!lockResult.ok || !lockResult.value) return;

  expect(lockResult.value.version).toBe(1);
  expect(lockResult.value.source).toBeDefined();
  expect(lockResult.value.source?.sha).toBe(repo.commitSha);
  expect(lockResult.value.source?.repo).toBe("org/repo");
});

it("re-sync with pinned SHA succeeds without fetching", async () => {
  run(["sync", projectDir]); // first sync
  const r = run(["sync", projectDir]); // second sync — uses pinned SHA
  expect(r.code).toBe(0);
});

it("sync with missing cached SHA fails with actionable error", async () => {
  // Write a lockfile with a fake SHA that isn't in the cache
  const fakeSha = "b".repeat(40);
  Bun.write(
    join(projectDir, ".agent-library.lock"),
    stringify({
      version: 1,
      cliVersion: "0.1.0",
      mode: "generated",
      target: "claude",
      syncedAt: new Date().toISOString(),
      source: { repo: "org/repo", sha: fakeSha, ref: "main", fetchedAt: new Date().toISOString() },
      include: ["global/skills/writing-plans"],
      artifacts: [],
    }),
  );
  const r = run(["sync", projectDir]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain(fakeSha);
  expect(r.stderr).toContain("sync --update");
});

it("sync --update fetches latest SHA and updates lockfile", async () => {
  run(["sync", projectDir]); // first sync
  const r = run(["sync", "--update", projectDir]);
  expect(r.code).toBe(0);

  const lockResult = await readLockfile(join(projectDir, ".agent-library.lock"));
  expect(lockResult.ok).toBe(true);
  if (!lockResult.ok || !lockResult.value) return;
  expect(lockResult.value.source?.sha).toBe(repo.commitSha);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/integration/sync-github-source.test.ts
```

Expected: FAIL — sync command ignores the `source` block and doesn't set up `homeRoot` from GitHub.

- [ ] **Step 3: Add `source` to `SyncPlan`**

In `src/sync/plan.ts`, add the `SyncPlanSource` interface and update `SyncPlan` and `buildPlan`:

```typescript
// Add after existing imports:
import type { LockfileSource } from "../lockfile/schema.ts";

// Add new interface (before SyncPlan):
export type SyncPlanSource = LockfileSource;

// Add source field to SyncPlan (after `include` field):
export interface SyncPlan {
  readonly mode: "generated" | "vendored";
  readonly target: TargetSelection;
  readonly projectRoot: AbsolutePath;
  readonly include: readonly string[];
  readonly source?: SyncPlanSource;          // <-- add this
  readonly writes: readonly PlanFileWrite[];
}

// Update buildPlan signature to accept optional source:
export function buildPlan(
  manifest: Manifest,
  artifacts: Artifact[],
  projectRoot: string,
  source?: SyncPlanSource,                   // <-- add this
): SyncPlan {
  // ... existing body unchanged, add source to return:
  return {
    mode: manifest.mode,
    target: manifest.target === "both" ? "both" : manifest.target,
    projectRoot: absolutePath(absProjectRoot),
    include: manifest.include,
    source,                                  // <-- add this
    writes,
  };
}
```

Locate the exact `return {` statement at the end of `buildPlan` in `src/sync/plan.ts` and add `source` to the returned object.

- [ ] **Step 4: Update `buildLockfileFromTargetEntries` to embed source**

In `src/sync/lockfile.ts`, update the `ResultKit.success(...)` call at line ~124 to include `source` and change version to 1:

```typescript
return ResultKit.success({
  version: 1 as const,
  cliVersion: (pkg as { version: string }).version,
  mode: plan.mode,
  target: plan.target,
  syncedAt: new Date().toISOString(),
  source: plan.source,           // <-- add (may be undefined — schema allows optional)
  include: [...plan.include],
  artifacts,
});
```

- [ ] **Step 5: Update `src/github/cache.ts` default cache root to support env override**

In `src/github/cache.ts`, replace the module-level `DEFAULT_CACHE_ROOT` const with a function so the env var is read at call time:

```typescript
// Remove:
// const DEFAULT_CACHE_ROOT = join(homedir(), ".cache", "agent-library");

// Add:
function defaultCacheRoot(): string {
  return process.env.AGENT_LIBRARY_CACHE_DIR ?? join(homedir(), ".cache", "agent-library");
}
```

Update `bareRepoCachePath` and `treePath` signatures to use `cacheRoot = defaultCacheRoot()` as their default.

- [ ] **Step 6: Update `sync` command**

Replace the body of `src/commands/sync.ts` with the updated version that adds `--update`, calls `resolveSource`, and threads `source` into `buildPlan`:

```typescript
import { Command } from "commander";
import { join, resolve } from "node:path";
import { loadManifest } from "../manifest/load.ts";
import {
  formatIssue,
  validateManifest,
  validateResolvedArtifactsScope,
  validateSkillSpecs,
} from "../manifest/validate.ts";
import { ManifestSchema } from "../manifest/schema.ts";
import { resolveIncludes } from "../resolve/sources.ts";
import { resolveSource } from "../resolve/source.ts";
import { resolveHomeRoot } from "../util/home.ts";
import { buildPlan } from "../sync/plan.ts";
import { writeArtifactId, writeTargetRelative } from "../sync/plan.ts";
import { runGeneratedSync } from "../sync/generated.ts";
import { runVendoredSync } from "../sync/vendored.ts";
import { printSummary, countByKind } from "../sync/summary.ts";
import { detectCollisions } from "../artifact/collision.ts";
import { upsertProjectEntry } from "../cache/registry.ts";

export const syncCommand = new Command("sync")
  .description("Sync agent library assets into a project")
  .argument(
    "<project-root>",
    "path to the project root containing .agent-library.yml",
  )
  .option("--home <path>", "override the home library root (bypasses source resolution)")
  .option("--dry-run", "print the sync plan without writing files")
  .option("--update", "fetch latest remote state and update pinned SHA in lockfile")
  .action(
    async (projectRoot: string, opts: { home?: string; dryRun?: boolean; update?: boolean }) => {
      const absProjectRoot = resolve(projectRoot);
      const manifestPath = join(absProjectRoot, ".agent-library.yml");
      const lockfilePath = join(absProjectRoot, ".agent-library.lock");
      const dryRun = opts.dryRun === true;
      const update = opts.update === true;

      const loaded = await loadManifest(manifestPath);
      if (!loaded.ok) {
        process.stderr.write(`error: cannot read ${manifestPath}\n`);
        process.exit(1);
      }

      const structuralIssues = validateManifest(loaded.value);
      if (structuralIssues.length > 0) {
        for (const issue of structuralIssues) process.stderr.write(`${formatIssue(issue)}\n`);
        process.exit(1);
      }

      const manifest = ManifestSchema.parse(loaded.value);

      // Determine homeRoot: from manifest source (GitHub) or --home / env fallback
      let homeRoot: string;
      let syncPlanSource: import("../sync/plan.ts").SyncPlanSource | undefined;

      if (manifest.source) {
        const sourceResult = await resolveSource(
          manifest.source,
          lockfilePath,
          { update },
        );
        if (!sourceResult.ok) {
          process.stderr.write(`error: ${sourceResult.error.message}\n`);
          process.exit(1);
        }
        homeRoot = sourceResult.value.homeRoot;
        syncPlanSource = sourceResult.value.source;
      } else {
        homeRoot = resolveHomeRoot(opts.home);
      }

      const ctx = {
        kind: "project" as const,
        homeRoot,
        projectRoot: absProjectRoot,
      };

      const resolveResult = await resolveIncludes(manifest.include, ctx);
      if (!resolveResult.ok) {
        process.stderr.write(`error: ${resolveResult.error.message}\n`);
        process.exit(1);
      }

      const artifacts = resolveResult.value;

      const resolvedScopeIssues = validateResolvedArtifactsScope(manifest, artifacts);
      if (resolvedScopeIssues.length > 0) {
        for (const issue of resolvedScopeIssues) process.stderr.write(`${formatIssue(issue)}\n`);
        process.exit(1);
      }

      const nameIssues = await validateSkillSpecs(artifacts);
      if (nameIssues.length > 0) {
        for (const issue of nameIssues) process.stderr.write(`${issue.path}: ${issue.message}\n`);
        process.exit(1);
      }

      const plan = buildPlan(manifest, artifacts, absProjectRoot, syncPlanSource);

      const collisions = detectCollisions(
        plan.writes.map((w) => ({
          artifactId: writeArtifactId(w),
          targetPath: writeTargetRelative(w),
        })),
      );
      if (collisions.length > 0) {
        for (const c of collisions) {
          process.stderr.write(
            `collision: '${c.targetPath}' is claimed by: ${c.sources.join(", ")}\n`,
          );
        }
        process.exit(1);
      }

      const counts = countByKind(plan);

      if (manifest.mode === "vendored") {
        const syncResult = await runVendoredSync(plan, { dryRun });
        if (!syncResult.ok) {
          process.stderr.write(`error: ${syncResult.error.message}\n`);
          process.exit(1);
        }
        if (!dryRun && syncPlanSource) {
          await upsertProjectEntry(undefined, {
            path: absProjectRoot,
            repo: syncPlanSource.repo,
            ref: syncPlanSource.ref,
            sha: syncPlanSource.sha,
            lastSyncedAt: new Date().toISOString(),
          });
        }
        printSummary({
          projectRoot: absProjectRoot,
          mode: manifest.mode,
          target: manifest.target,
          skills: counts.skills,
          commands: counts.commands,
          agents: counts.agents,
          removedStale: 0,
          vendoredSkipped: syncResult.value.skipped.map((s) => ({
            path: s.path,
            reason: s.reason,
          })),
          lockfile: ".agent-library.lock",
          dryRun,
        });
        return;
      }

      const syncResult = await runGeneratedSync(plan, { dryRun });
      if (!syncResult.ok) {
        process.stderr.write(`error: ${syncResult.error.message}\n`);
        process.exit(1);
      }
      if (!dryRun && syncPlanSource) {
        await upsertProjectEntry(undefined, {
          path: absProjectRoot,
          repo: syncPlanSource.repo,
          ref: syncPlanSource.ref,
          sha: syncPlanSource.sha,
          lastSyncedAt: new Date().toISOString(),
        });
      }
      printSummary({
        projectRoot: absProjectRoot,
        mode: manifest.mode,
        target: manifest.target,
        skills: counts.skills,
        commands: counts.commands,
        agents: counts.agents,
        removedStale: syncResult.value.removedStale,
        lockfile: ".agent-library.lock",
        dryRun,
      });
    },
  );
```

Note: `AGENT_LIBRARY_CACHE_DIR` env var needs to thread through to `resolveSource`. Add a check in `src/resolve/source.ts` to read `process.env.AGENT_LIBRARY_CACHE_DIR` as the `cacheRoot` default so integration tests can isolate cache state.

- [ ] **Step 7: Run integration tests to verify they pass**

```bash
bun test tests/integration/sync-github-source.test.ts
```

Expected: PASS for all 4 tests.

- [ ] **Step 8: Run full test suite to verify no regressions**

```bash
bun test
```

Expected: all tests PASS. Existing tests that use `HOME_AGENT_LIBRARY` still work because `manifest.source` is absent in their fixtures, so `homeRoot` falls back to `resolveHomeRoot(opts.home)`.

- [ ] **Step 9: Commit**

```bash
git add src/sync/plan.ts src/sync/lockfile.ts src/commands/sync.ts src/resolve/source.ts tests/integration/sync-github-source.test.ts
git commit -m "feat(sync): wire resolveSource phase, --update flag, and source block in lockfile"
```

---

### Task 7: `cache prune` Command

**Depends on:** Task 5 (registry)

**Files:**
- Create: `src/commands/cache.ts`
- Modify: `src/cli.ts`
- Create: `tests/integration/cache-prune.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/cache-prune.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

let cacheDir: string;
let projectDir: string;

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: { ...process.env, AGENT_LIBRARY_CACHE_DIR: cacheDir },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "al-prune-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "al-prune-proj-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

function makeLockfile(projectPath: string, sha: string): void {
  writeFileSync(
    join(projectPath, ".agent-library.lock"),
    stringify({
      version: 1,
      cliVersion: "0.1.0",
      mode: "generated",
      target: "claude",
      syncedAt: "2026-05-11T00:00:00.000Z",
      source: { repo: "org/repo", sha, ref: "main", fetchedAt: "2026-05-11T00:00:00.000Z" },
      include: ["global/skills/foo"],
      artifacts: [],
    }),
  );
}

function makeTree(cacheRoot: string, sha: string): string {
  const treesDir = join(cacheRoot, "trees");
  mkdirSync(treesDir, { recursive: true });
  const treePath = join(treesDir, sha);
  mkdirSync(treePath);
  writeFileSync(join(treePath, "README.md"), "content");
  return treePath;
}

function makeRegistry(cacheRoot: string, projects: { path: string; sha: string }[]): void {
  writeFileSync(
    join(cacheRoot, "projects.json"),
    JSON.stringify({
      projects: projects.map((p) => ({
        path: p.path,
        repo: "org/repo",
        ref: "main",
        sha: p.sha,
        lastSyncedAt: "2026-05-11T00:00:00.000Z",
      })),
    }, null, 2),
  );
}

it("prune removes trees not referenced by any active lockfile", () => {
  const activeSha = "a".repeat(40);
  const orphanSha = "b".repeat(40);

  makeTree(cacheDir, activeSha);
  const orphanPath = makeTree(cacheDir, orphanSha);
  makeLockfile(projectDir, activeSha);
  makeRegistry(cacheDir, [{ path: projectDir, sha: activeSha }]);

  const r = run(["cache", "prune"]);
  expect(r.code).toBe(0);
  expect(existsSync(join(cacheDir, "trees", activeSha))).toBe(true);
  expect(existsSync(orphanPath)).toBe(false);
});

it("prune skips projects whose lockfile no longer exists", () => {
  const sha = "c".repeat(40);
  const treePath = makeTree(cacheDir, sha);
  // Register project but don't create lockfile
  makeRegistry(cacheDir, [{ path: "/nonexistent/project", sha }]);

  const r = run(["cache", "prune"]);
  expect(r.code).toBe(0);
  // Tree is removed because no active lockfile references it
  expect(existsSync(treePath)).toBe(false);
});

it("prune succeeds with empty registry", () => {
  makeRegistry(cacheDir, []);
  const r = run(["cache", "prune"]);
  expect(r.code).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/integration/cache-prune.test.ts
```

Expected: FAIL — `cache` command unknown / does not exist.

- [ ] **Step 3: Implement `src/commands/cache.ts`**

```typescript
import { Command } from "commander";
import { readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readRegistry } from "../cache/registry.ts";
import { readLockfile } from "../lockfile/read.ts";

function defaultCacheRoot(): string {
  return process.env.AGENT_LIBRARY_CACHE_DIR ?? join(homedir(), ".cache", "agent-library");
}

export const cacheCommand = new Command("cache")
  .description("Manage the agent-library cache");

cacheCommand
  .command("prune")
  .description("Remove extracted trees not referenced by any active lockfile")
  .action(async () => {
    const cacheRoot = defaultCacheRoot();
    const registryPath = join(cacheRoot, "projects.json");
    const treesDir = join(cacheRoot, "trees");

    const registryResult = await readRegistry(registryPath);
    if (!registryResult.ok) {
      process.stderr.write(`error: ${registryResult.error.message}\n`);
      process.exit(1);
    }

    // Collect all SHAs referenced by active lockfiles
    const activeShas = new Set<string>();
    for (const project of registryResult.value.projects) {
      const lockfilePath = join(project.path, ".agent-library.lock");
      if (!existsSync(lockfilePath)) continue;
      const lockResult = await readLockfile(lockfilePath);
      if (lockResult.ok && lockResult.value?.source) {
        activeShas.add(lockResult.value.source.sha);
      }
    }

    // Delete extracted trees not in the active set
    if (!existsSync(treesDir)) {
      process.stdout.write("cache prune: no trees directory found\n");
      return;
    }

    let pruned = 0;
    for (const entry of readdirSync(treesDir)) {
      if (!activeShas.has(entry)) {
        rmSync(join(treesDir, entry), { recursive: true, force: true });
        pruned++;
      }
    }

    process.stdout.write(`cache prune: removed ${pruned} unreferenced tree(s)\n`);
  });
```

- [ ] **Step 4: Register `cacheCommand` in `src/cli.ts`**

```typescript
import { cacheCommand } from "./commands/cache.ts";
// Add after existing addCommand calls:
program.addCommand(cacheCommand);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/integration/cache-prune.test.ts
```

Expected: PASS for all 3 tests.

- [ ] **Step 6: Run full test suite**

```bash
bun test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/commands/cache.ts src/cli.ts tests/integration/cache-prune.test.ts
git commit -m "feat(cache): add cache prune command to remove unreferenced extracted trees"
```

---

## Post-Implementation Checklist

- [ ] `bun test` passes completely
- [ ] `agent-library sync` with a manifest containing `source` fetches, materializes, and syncs correctly
- [ ] `agent-library sync` without `source` still works via `--home` / `HOME_AGENT_LIBRARY` (regression)
- [ ] `agent-library sync --update` bumps the SHA and re-syncs
- [ ] `agent-library sync` on a machine with cleared cache and a lockfile fails with actionable message containing the SHA and "sync --update"
- [ ] `agent-library cache prune` removes only trees not referenced by any active lockfile
- [ ] Lockfile version is `1` in all newly written lockfiles
