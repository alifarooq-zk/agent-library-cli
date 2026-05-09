# ADR 0009: Project-Local Source Includes

Date: 2026-05-08
Status: Accepted

## Context

Some projects need domain-specific assets that should not live in the global home catalog. Those assets still need the same validation, adapter, sync, and lockfile behavior as canonical assets.

## Decision

Allow project-local source assets under:

```text
<project>/.agent-library
```

Manifest entries beginning with `./` resolve from that local source root.

Bare paths still resolve from `~/.agent-library`. Profile references still resolve from `~/.agent-library/profiles`.

## Consequences

Projects can keep local domain knowledge with the project.

Local sources do not need to live inside `.agents` or `.claude`.

The resolver must carry project-root context and reject `./` includes when no project context exists.

