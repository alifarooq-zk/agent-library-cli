# ADR 0007: Lockfile Hash Ownership Model

Date: 2026-05-08
Status: Accepted

## Context

Sync needs to know which files it can update. File presence alone cannot distinguish generated output, vendored output, and local edits.

## Decision

Write `.agent-library.lock` after sync. The lockfile records:

- Manifest version.
- Mode and target.
- Original include entries.
- Expanded artifact paths.
- Source paths and hashes.
- Target paths and hashes.
- Adapter state. Targets record `{ kind: "none" }` when no adapter was used, or `{ kind: "applied", source, hash }` when a target-specific adapter was appended.
- Sync timestamp.
- CLI version.

Current lockfiles use schema version 1. The adapter state field uses a discriminated union (`{ kind: "none" }` or `{ kind: "applied", source, hash }`). An optional `source` block records the GitHub repo, ref, and resolved SHA when sync was driven by a remote source.

Vendored updates compare the current target hash to the previous lockfile target hash. If they differ, sync treats the file as locally edited and skips it.

Generated cleanup uses the previous lockfile plus generated markers before deleting stale files.

## Consequences

Sync can make ownership decisions from recorded state.

Vendored files can be committed and locally edited without silent overwrite.

Generated stale cleanup can stay conservative.
