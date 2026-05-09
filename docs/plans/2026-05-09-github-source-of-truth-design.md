# GitHub Source of Truth + Explicit Update Sync

Date: 2026-05-09  
Status: Approved

## Problem

The current model assumes a locally managed canonical library path (`~/.agent-library`). That works, but distribution and updates depend on local git workflows and manual pull discipline. Teams need a shared remote source of truth with predictable, opt-in updates.

## Goals

1. Make a GitHub repository the canonical source for library assets.
2. Keep sync reproducible by pinning installs to an exact git commit in lockfile.
3. Add explicit update behavior so users can re-sync to the latest remote state when they choose.
4. Preserve existing include semantics and domain-first source layout.

## Non-Goals

1. No implicit auto-update on every sync.
2. No silent fallback to local sources.
3. No backward compatibility with previous lockfile schema versions. The tool is pre-release; lockfile schema resets to v1.

## Recommended Approach

Use a persistent bare-repo cache under user cache, then materialize by pinned SHA:

- Bare repo cache path: `~/.cache/agent-library/repos/<sha256-of-clone-url>.git` (hash of the full HTTPS clone URL, e.g. `https://github.com/org/repo.git`)
- Extracted tree path: `~/.cache/agent-library/trees/<sha>/` (SHA-keyed; multiple projects pinned to the same commit share one extracted tree)
- `sync` uses the commit SHA pinned in `.agent-library.lock`.
- `sync --update` fetches remote, resolves new SHA, updates lockfile, then syncs.
- If the bare repo cache is missing the pinned SHA (e.g. new machine, cleared cache), `sync` fails with a clear error: "locked SHA `<sha>` not in local cache, run `sync --update` to fetch." No silent fallback fetch.
- `agent-library cache prune` scans all known project lockfiles, collects SHAs still in use, and deletes extracted trees not referenced by any lockfile.

## Alternatives Considered

### A) Temp clone per sync

Simple to implement but slower and wasteful for repeated use.

### B) Persistent bare repo cache (**chosen**)

Best balance of speed, determinism, and explicit offline behavior. Once locked, sync is fully local until the user opts into an update.

### C) GitHub archive download per ref

No git operations required but weaker branch/ref workflows and less ergonomic for frequent updates.

## Manifest Model

`source` is required. GitHub is the only supported source type.

```yaml
version: 1
mode: generated
target: both
source:
  type: github
  repo: org/agent-library
  ref: main # optional default tracking ref
include:
  - global
  - profile:universal
```

Notes:

- `source.type=github` is the only valid value.
- `source.ref` is required. There is no default branch fallback.
- Include entries are unchanged from the existing model.

## Lockfile Model

Lockfile schema resets to v1. The `source` block is required.

```ts
{
  version: 1,
  cliVersion: string,
  mode: "generated" | "vendored",
  target: "codex" | "claude" | "both",
  syncedAt: string,       // ISO 8601
  source: {
    repo: string,         // "org/name"
    sha: string,          // pinned commit SHA
    ref: string,          // tracked ref e.g. "main"
    fetchedAt: string,    // ISO 8601, last time bare-repo was fetched
  },
  include: string[],
  artifacts: Artifact[]   // unchanged: id, kind, files[{ source, sourceHash, targets[{ path, targetHash, adapter }] }]
}
```

Behavior:

- Plain `sync` uses lockfile `sha`. Fails with typed error if SHA is not in local bare-repo cache.
- `sync --update` fetches remote, resolves new SHA, updates lockfile, then syncs.

## Command Behavior

### `agent-library sync <project-root>`

Pipeline: `loadManifest -> resolveSource -> validate -> resolveIncludes -> expandBundles -> planArtifacts -> detectCollisions -> write -> updateLockfile`

`resolveSource` is a new phase that runs before `resolveIncludes` and produces a `homeRoot: string` (the extracted tree path). `resolveIncludes` and all downstream phases are unchanged — they remain path-agnostic.

`resolveSource` steps:
1. Derive clone URL from `source.repo` (`org/name` → `https://github.com/<org>/<repo>.git`).
2. If lockfile present: use pinned SHA. Fail with typed error if SHA not in bare-repo cache.
3. If no lockfile: fetch bare-repo cache and resolve SHA from `source.ref`.
4. Materialize extracted tree via `git archive <sha> | tar -x -C ~/.cache/agent-library/trees/<sha>/`. Skip if directory already exists.
5. Return extracted tree path as `homeRoot`.
6. Register project root in `~/.cache/agent-library/projects.json`.
7. Write lockfile v1 with source metadata.

### `agent-library sync --update <project-root>`

1. Fetch latest from remote for configured `source.repo` and `source.ref`.
2. Resolve new commit SHA.
3. Materialize extracted tree via `git archive <new-sha> | tar -x -C ~/.cache/agent-library/trees/<new-sha>/` if not already present.
4. Update lockfile SHA to new value.
5. Run normal sync pipeline.

### `agent-library cache prune`

1. Read project registry at `~/.cache/agent-library/projects.json` (populated by every `sync` run).
2. Collect all SHAs referenced by lockfiles in registered projects (skip projects whose lockfile no longer exists).
3. Delete extracted trees under `~/.cache/agent-library/trees/` not referenced by any active lockfile.

Every `sync` run writes the project entry to `projects.json` — updating in-place if it exists, appending if not.

```json
{
  "projects": [
    {
      "path": "/home/user/work/project-a",
      "repo": "org/agent-library",
      "ref": "main",
      "sha": "abc123def456...",
      "lastSyncedAt": "2026-05-09T12:00:00Z"
    }
  ]
}
```

## Error Handling (ResultKit-Aligned)

Introduce typed errors for:

- GitHub auth/permission failure
- repo not found
- ref not found
- fetch timeout/network failure
- cache corruption/materialization failure
- locked SHA not in local cache

Rules:

- No broad catch-and-ignore.
- No silent fallback.
- Messages must be actionable (what failed + how to fix).

## Testing Strategy

1. Unit tests
   - manifest source validation (source block required, type must be `github`)
   - source resolver behavior with/without lockfile
   - lockfile v1 schema validation
   - lockfile update transitions
   - typed error mapping
2. Integration tests
   - first-time sync from GitHub source (no lockfile)
   - re-sync pinned SHA without update (local only)
   - cache miss on plain sync returns correct error
   - update flow bumps SHA and writes new content
   - unreachable remote/auth failure
   - `cache prune` removes only unreferenced trees

## Authentication

Public repos require no authentication. Private repos require `GITHUB_TOKEN` to be set in the environment. If `GITHUB_TOKEN` is unset and the repo is private, `sync` fails with a clear error: "repo not accessible — set GITHUB_TOKEN for private repos." No git credential helper fallback in v1.

## Out of Scope for v1

- `sync --update --to-ref <tag|sha>`: pin to a specific ref at update time. Users can set `source.ref` in the manifest instead.
- Signed-tag-only update policy.
