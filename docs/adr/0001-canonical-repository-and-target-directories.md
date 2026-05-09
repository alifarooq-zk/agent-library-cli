# ADR 0001: Canonical Repository And Target Directories

Date: 2026-05-08
Status: Accepted

## Context

Agent assets can be consumed by several harnesses, but each harness uses its own target directory. If `.agents` or `.claude` becomes canonical, the same asset can drift across tools.

## Decision

Use `~/.agent-library` as the canonical Git-versioned repository. Treat `.agents` and `.claude` as generated or vendored deployment targets only.

The source asset catalog, documentation, and profiles live in `~/.agent-library`. The CLI source code and tests live in a separate repository at `~/.agent-library-cli`. The compiled binary is symlinked into `$PATH` from that location.

## Consequences

Asset updates happen in one place before sync writes target output.

Projects can depend on the canonical library without making target directories sources of truth.

Existing `.agents` and `.claude` content is not migrated by version 1.

## Related

- `docs/specs/2026-05-08-agent-library-standard.md`
- `docs/plans/2026-05-08-agent-library-cli.md`

