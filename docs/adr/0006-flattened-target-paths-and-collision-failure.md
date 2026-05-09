# ADR 0006: Flattened Target Paths And Collision Failure

Date: 2026-05-08
Status: Accepted

## Context

Source paths are domain-qualified, but target harnesses expect simple `.agents` and `.claude` layouts. Flattening creates a risk that two source assets write the same target path.

## Decision

Flatten target paths by artifact basename:

```text
frontend/skills/react-useeffect -> .agents/skills/react-useeffect/SKILL.md
global/agents/security-reviewer -> .agents/agents/security-reviewer.md
```

Fail validation when two included artifacts map to the same target path.

Version 1 does not support aliases or last-write-wins behavior.

## Consequences

Target output stays compatible with current harness layouts.

Collisions are visible before sync writes files.

Users must rename or exclude colliding source assets.

