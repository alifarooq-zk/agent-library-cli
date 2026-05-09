# ADR 0002: Domain-First Source Layout

Date: 2026-05-08
Status: Accepted

## Context

The library needs universal workflow assets and optional domain-specific assets. A flat layout would make ownership and install selection unclear as the catalog grows.

## Decision

Use a domain-first source layout:

```text
<domain>/skills/<name>/SKILL.md
<domain>/commands/<name>.md
<domain>/agents/<name>.md
```

Reserve `global` for universal workflow assets. Framework-specific, database-specific, monorepo-specific, and domain-specific assets must live outside `global`.

## Consequences

Manifest entries are domain-qualified and easy to trace.

The global set stays small and reusable.

Target paths still flatten to harness-compatible locations, so collision detection is required.

## Related

- [ADR 0006](0006-flattened-target-paths-and-collision-failure.md)

