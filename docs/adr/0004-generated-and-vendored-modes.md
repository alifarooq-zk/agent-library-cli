# ADR 0004: Generated And Vendored Modes

Date: 2026-05-08
Status: Accepted

## Context

Some projects want target files treated as build artifacts. Other projects need portable committed copies that work without the user's home library.

## Decision

Support two modes:

- `generated`: target files are sync-owned build artifacts.
- `vendored`: target files are project-owned copies with source provenance.

Generated files receive generated headers and may be overwritten or cleaned up when marked as agent-library output.

Vendored files receive vendored headers and are updated only when lockfile hashes prove they have not been locally edited.

## Consequences

Projects can choose between central management and portable committed copies.

Generated mode can clean stale files safely.

Vendored mode preserves local edits and reports conflicts instead of overwriting.

## Related

- [ADR 0007](0007-lockfile-hash-ownership-model.md)

