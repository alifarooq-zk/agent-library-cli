# ADR 0015: Lockfile Source Preserved Under Home

Date: 2026-05-16
Status: Accepted

## Context

`sync <project> --home <local-tree>` does not resolve a Git SHA, so it cannot produce a new `LockfileSource`.

## Decision

When `--home` is used for a project sync, preserve any prior lockfile `source` block and do not overwrite it. If a project has only ever synced with `--home`, the lockfile may omit `source`.

## Consequences

Local dev-loop syncs do not erase provenance from the last real GitHub sync. The lockfile source now represents the most recent sync that resolved GitHub source, not necessarily the most recent sync command.
