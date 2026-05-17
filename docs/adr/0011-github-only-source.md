# ADR 0011: GitHub-Only Source

Date: 2026-05-16
Status: Accepted

## Context

The CLI previously treated a local library checkout as the canonical source, so provenance was implicit and machine-specific.

## Decision

Require every manifest to include a GitHub `source` block with `type`, `repo`, and `ref`. The canonical source is the GitHub repo at the resolved SHA, not a local fallback path.

## Consequences

Manifests without `source` must be updated. Syncs become reproducible across machines. A local `~/.agent-library/` checkout remains useful for library-author development, but the CLI consults it only when a command receives an explicit override.
