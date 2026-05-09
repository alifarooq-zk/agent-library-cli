# ADR 0005: Additive Target Adapters

Date: 2026-05-08
Status: Accepted

## Context

Most asset content should remain neutral across agent harnesses, but some targets need extra wording or usage notes.

## Decision

Keep source assets agent-neutral by default. Add optional target adapters that append target-specific notes after the neutral source.

Skills use:

```text
<skill>/adapters/claude.md
<skill>/adapters/codex.md
```

Standalone markdown artifacts use sibling adapter directories:

```text
<name>.adapters/claude.md
<name>.adapters/codex.md
```

Adapters are additive. Version 1 does not support full target-specific forks.

## Consequences

Most content remains shared and easy to review.

Target-specific guidance can exist without duplicating whole assets.

The sync pipeline must merge header, neutral source, and adapter content in a stable order.

