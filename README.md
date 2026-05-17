# Agent Library

Package-managed skills, commands, and agents for Claude and Codex.

`agent-library` syncs reusable agent assets from a GitHub repository into the local folders that agent tools actually read:

```text
Claude:  ~/.claude/skills/            or <project>/.claude/skills/
Codex:   ~/.agents/skills/            or <project>/.agents/skills/
```

Keep the source in GitHub. Let each project opt in with a manifest. Sync writes the selected assets, records exact provenance in a lockfile, and protects local edits when files are vendored.

## Why This Exists

Agent skills and commands are usually copied by hand. That works for one project, then fails when the same asset needs to live in Claude, Codex, a team repo, and a personal global setup.

This CLI treats agent assets like software dependencies:

- Manifests declare what a project uses.
- GitHub refs resolve to pinned commits.
- Lockfiles record installed assets and hashes.
- Generated mode lets the CLI own output files.
- Vendored mode lets projects commit and edit output files safely.
- One source library can target Claude, Codex, or both.

## Install

Install dependencies and build the local binary:

```bash
bun install
bun run build
```

Then put `bin/agent-library` or `bin/agent-library.exe` on your `PATH`.

## Quick Start

Create a manifest in a project:

```yaml
version: 1
mode: generated
target: both
source:
  type: github
  repo: owner/my-agent-library
  ref: main
include:
  - frontend
  - backend/skills/postgres-patterns
```

Sync the assets into that project:

```bash
agent-library sync ~/projects/my-app
```

The CLI fetches the source repository, materializes the pinned tree in the local cache, writes `.agents/` and/or `.claude/`, and creates `.agent-library.lock`.

## Library Layout

A source library uses a domain-first layout:

```text
my-agent-library/
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

See [examples/basic-library](examples/basic-library) for a copyable starter library.

## Generated vs Vendored

Use `generated` when target files are build output:

```yaml
mode: generated
```

Generated files may be overwritten or removed by future syncs when the lockfile and ownership header prove they are safe to manage.

Use `vendored` when the project should own the synced files:

```yaml
mode: vendored
```

Vendored files can be committed and edited. Sync updates them only when the lockfile proves the local copy has not changed.

## Common Commands

```bash
agent-library init ~/projects/my-app
agent-library sync ~/projects/my-app
agent-library sync --dry-run ~/projects/my-app
agent-library sync --update ~/projects/my-app
agent-library validate ~/projects/my-app
agent-library list artifacts
agent-library cache prune
```

For global installs, create a home-scoped manifest and sync with `--global`:

```bash
agent-library init --global
agent-library sync --global
```

## Documentation

- [Usage Guide](USAGE.md)
- [Project Context](CONTEXT.md)
- [Architecture Decisions](docs/adr/README.md)

## Development

```bash
bun run typecheck
bun test
bun run check
```

The implementation is a Bun/TypeScript CLI. The sync path is intentionally staged: load manifest, validate, resolve includes, build a plan, detect collisions, write output, and update the lockfile.
