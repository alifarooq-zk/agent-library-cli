# ADR 0003: Explicit YAML Manifests

Date: 2026-05-08
Status: Accepted

## Context

The sync tool must avoid implicit installs. Projects should know exactly which assets, profiles, and bundles they use.

## Decision

Every install target uses `.agent-library.yml` with required fields:

```yaml
version: 1
mode: generated
target: both
include:
  - profile:universal
```

There are no defaults. The CLI refuses to sync when a required field is missing or invalid.

Profiles may include artifact paths and bundle paths. Version 1 rejects nested profile references.

## Consequences

Sync behavior is explicit and reviewable.

Validation can fail before any files are written.

Users must choose install mode, target, and included assets instead of relying on convention.

## Related

- [ADR 0010](0010-cli-command-interaction-model.md)

