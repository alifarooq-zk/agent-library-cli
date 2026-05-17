# Basic Agent Library Example

This is a minimal source library that `agent-library` can sync into Claude and Codex targets.

Use it as a template for your own GitHub-backed library:

```text
basic-library/
  global/
    skills/
      writing-plans/
        SKILL.md
    commands/
      review-pr.md
    agents/
      security-reviewer.md
  frontend/
    skills/
      react-useeffect/
        SKILL.md
        adapters/
          claude.md
          codex.md
  profiles/
    frontend.yml
```

A project can include the whole `frontend` domain, a single artifact, or a profile:

```yaml
version: 1
mode: generated
target: both
source:
  type: github
  repo: owner/my-agent-library
  ref: main
include:
  - profile:frontend
```

The `global` domain is reserved for home-scoped manifests. Use it in `~/.agent-library.yml` with `scope: home`.
