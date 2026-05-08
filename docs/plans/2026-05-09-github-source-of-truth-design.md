# GitHub Source of Truth + Explicit Update Sync

Date: 2026-05-09  
Status: Approved

## Problem

The current model assumes a locally managed canonical library path (`~/.agent-library`). That works, but distribution and updates depend on local git workflows and manual pull discipline. Teams need a shared remote source of truth with predictable, opt-in updates.

## Goals

1. Make a GitHub repository the default canonical source for library assets.
2. Keep sync reproducible by pinning installs to an exact git commit in lockfile.
3. Add explicit update behavior so users can re-sync to the latest remote state when they choose.
4. Preserve existing include semantics and domain-first source layout.

## Non-Goals

1. No implicit auto-update on every sync.
2. No silent fallback to local sources when GitHub is configured.
3. No change to generated vs vendored ownership model semantics.

## Recommended Approach

Use a persistent bare-repo cache (recommended) under user cache, then materialize by pinned ref:

- Cache path example: `~/.cache/agent-library/repos/<repo-hash>.git`
- `sync` uses the commit pinned in `.agent-library.lock` by default.
- `sync --update` fetches remote and updates lockfile to a newer selected commit, then syncs.

This provides fast subsequent syncs, reproducibility, and optional offline behavior after the first fetch.

## Alternatives Considered

### A) Temp clone per sync

Simple to implement but slower and wasteful for repeated use.

### B) Persistent bare repo cache (**chosen**)

Best balance of speed, determinism, and robust UX for repeated syncs.

### C) GitHub archive download per ref

No git operations required but weaker branch/ref workflows and less ergonomic for frequent updates.

## Manifest Model

Add a source block:

```yaml
version: 1
mode: generated
target: both
source:
  type: github
  repo: org/agent-library
  ref: main # optional default ref
include:
  - global
  - profile:universal
```

Notes:

- `source.type=github` means source resolution is remote-first.
- `source.ref` sets default tracking ref when lockfile is absent.
- Existing include entries remain unchanged.

## Lockfile Model

Extend `.agent-library.lock` with source metadata:

- repo URL or `org/name`
- resolved commit SHA
- tracked ref (if any)
- source content hash metadata already used for ownership checks
- last fetch/update metadata

Behavior:

- Plain `sync` uses lockfile SHA if present.
- `sync --update` fetches remote, resolves new SHA, updates lockfile, then syncs.

## Command Behavior

### `agent-library sync <project-root>`

1. Read manifest and lockfile.
2. Resolve source commit:
   - lockfile SHA if present
   - otherwise manifest ref/default branch HEAD
3. Materialize source tree from cache.
4. Run existing resolve -> plan -> collision -> write pipeline.
5. Persist lockfile state.

### `agent-library sync --update <project-root>`

1. Fetch latest from remote for configured repo/ref.
2. Resolve new commit SHA.
3. Update lockfile SHA to new value.
4. Run normal sync pipeline.

## Error Handling (ResultKit-Aligned)

Introduce typed errors for:

- GitHub auth/permission failure
- repo not found
- ref not found
- fetch timeout/network failure
- cache corruption/materialization failure
- lockfile/source mismatch

Rules:

- No broad catch-and-ignore.
- No silent fallback to local path when `source.type=github`.
- Messages must be actionable (what failed + how to fix).

## Testing Strategy

1. Unit tests
   - manifest source validation
   - source resolver behavior with/without lockfile
   - lockfile update transitions
   - typed error mapping
2. Integration tests
   - first-time sync from GitHub source
   - re-sync pinned SHA without update
   - update flow bumps SHA and writes new content
   - unreachable remote/auth failure
   - include resolution parity with local model

## Migration / Backward Compatibility

1. Existing manifests without `source` continue to use local path behavior.
2. GitHub source is additive, not a breaking replacement for existing users.
3. Teams can migrate project-by-project by adding `source` and running `sync --update`.

## Open Questions

1. Authentication precedence (`GITHUB_TOKEN` vs git credential helper) for private repos.
2. Whether to support optional signed-tag-only update policy later.
3. Whether `sync --update` should support `--to-ref <tag|sha>` in v1 of this feature.
