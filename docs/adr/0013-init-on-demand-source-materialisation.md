# ADR 0013: Init On-Demand Source Materialisation

Date: 2026-05-16
Status: Accepted

## Context

GitHub-only source means a new user may not have any local library tree, but `init` still needs to show an include picker backed by the available catalogue.

## Decision

After `init` captures `source.repo` and `source.ref`, it materialises that source with `resolveSource()` and builds the picker from the resulting tree. The first init for a repo/ref may clone from GitHub; later inits against the same SHA use the cache.

## Consequences

`init` normally needs network access. If source materialisation fails, `init` falls back to free-text include entry and still writes the manifest so a later `sync` can retry. Cache pruning for bare repos remains future work.
