# ADR 0014: List And Validate Manifest-Aware

Date: 2026-05-16
Status: Accepted

## Context

`list` and `validate` previously walked the implicit local library root. Under GitHub-only source, there is no implicit local tree.

## Decision

Make `list` read the project manifest and list from the lockfile-pinned SHA; when no lockfile exists, it resolves the manifest ref and warns that the result is not pinned. Make `validate` require a lockfile-pinned SHA for include-resolution, with `--no-resolve` for structural-only validation before the first sync.

## Consequences

Both commands now work from project context. Fresh projects must run `sync` before full `validate`, or pass `--no-resolve`. CI jobs that validated before syncing must choose one of those paths explicitly.
