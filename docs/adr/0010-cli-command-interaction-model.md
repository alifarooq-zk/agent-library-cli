# ADR 0010: CLI Command Interaction Model

Date: 2026-05-08
Status: Accepted

## Context

Validation, listing, and sync should be predictable in scripts and CI. Manifest creation benefits from guided prompts.

## Decision

Provide these commands:

```bash
agent-library validate <path>
agent-library list domains
agent-library list profiles
agent-library list artifacts
agent-library sync <path>
agent-library init <path>        # planned — not yet implemented
```

Keep `validate`, `list`, and `sync` non-interactive. Make `init` interactive by default with `@clack/prompts`.

Support `sync --dry-run` so users can inspect writes and deletes without touching disk or the lockfile. `--dry-run` and `init` are accepted decisions planned for implementation slice 10; they do not exist in the current codebase.

## Consequences

CI can use validation and sync safely.

Users can create manifests without memorizing the schema.

Dry-run output gives a review step before sync mutates target directories.
