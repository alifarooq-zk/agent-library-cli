# Agent Library — Usage Guide

## What it is

`~/.agent-library` is the canonical source of skills, commands, and agents. The CLI (`agent-library`) syncs assets from this library into the target directories that Claude and Codex actually read.

Neither Claude nor Codex reads `~/.agent-library` directly. They read:

```
Claude:  ~/.claude/skills/            ← global, every project
         <project>/.claude/skills/    ← local, that project only

Codex:   ~/.agents/skills/            ← global, every project
         <project>/.agents/skills/    ← local, that project only
```

Until you sync, a skill in the library is invisible to both tools.

---

## Setup

The CLI binary lives at `~/.agent-library-cli/bin/agent-library`, symlinked into PATH:

```bash
ln -sf ~/.agent-library-cli/bin/agent-library ~/.local/bin/agent-library
agent-library --version
```

To rebuild the binary after changes:

```bash
cd ~/.agent-library-cli
bun run build
```

---

## Library structure

```
~/.agent-library/
  global/          — universal skills (writing, workflow, security, TDD)
    agents/        — security-reviewer, performance-optimizer
    skills/        — brainstorming, tdd, humanizer, writing-plans, …
  frontend/        — React, UI, state management
    skills/        — shadcn, react-useeffect, react-use-context, …
  backend/         — databases, server patterns
    agents/        — database-reviewer
    skills/        — api-design, postgres-patterns, database-migrations, …
  fullstack/       — cross-stack concerns
    skills/        — turborepo, full-stack-wiki, backend-to-frontend-handoff-docs
  agent-tools/     — meta skills for creating and judging other skills
    skills/        — skill-creator, skill-judge
  profiles/        — named include bundles (optional)
```

---

## Three levels of skill availability

### Level 1 — Global (every project)

Create `~/.agent-library.yml` and sync into your home directory:

```yaml
# ~/.agent-library.yml
version: 1
mode: generated
target: both
include:
  - global
  - agent-tools
```

```bash
agent-library sync ~
```

Writes into `~/.claude/skills/` and `~/.agents/skills/`. Every project you open will have these skills automatically.

---

### Level 2 — Project skills from the library (one project only)

Create `.agent-library.yml` inside the project and sync into the project root:

```yaml
# ~/projects/my-app/.agent-library.yml
version: 1
mode: generated
target: both
include:
  - frontend
  - backend/skills/postgres-patterns
  - backend/skills/database-migrations
```

```bash
agent-library sync ~/projects/my-app
```

Writes into `~/projects/my-app/.claude/skills/` and `~/projects/my-app/.agents/skills/`. Only visible when working inside that project.

---

### Level 3 — Project-local skills (defined inside the project)

Use this for skills containing project-private knowledge: internal API conventions, business rules, proprietary patterns. These skills live inside the project repo and travel with the codebase.

**Directory structure:**

```
~/projects/my-app/
  .agent-library/              ← project's local source root
    product/                   ← domain name (your choice)
      skills/
        payments-flow/
          SKILL.md             ← frontmatter must include: name: payments-flow
  .agent-library.yml
```

**Reference with `./` in the manifest:**

```yaml
# ~/projects/my-app/.agent-library.yml
version: 1
mode: generated
target: both
include:
  - frontend
  - ./product/skills/payments-flow   # resolves from .agent-library/ inside the project
```

The `./` prefix tells the CLI to look in `<project>/.agent-library/`, not `~/.agent-library/`. The path after `./` follows the same domain-first layout as the main library.

After sync, `payments-flow` appears in `.claude/skills/` and `.agents/skills/` alongside the library skills — but only inside `my-app`.

---

## Sync modes

### generated (default)

The CLI owns the target files. Re-running sync overwrites them. Safe to re-run at any time.

```yaml
mode: generated
```

Add `.claude/`, `.agents/`, and `.agent-library.lock` to `.gitignore` — regenerate them on demand.

### vendored

You own the target files. The CLI only updates a file if its on-disk hash matches the lockfile's previous hash (i.e. you haven't edited it locally).

```yaml
mode: vendored
```

Commit `.claude/`, `.agents/`, and `.agent-library.lock` — the files are yours to modify.

---

## Common commands

```bash
# Preview what sync would write without touching disk
agent-library sync --dry-run ~/projects/my-app

# Validate a manifest without syncing
agent-library validate ~/projects/my-app

# List all skills in the library
agent-library list artifacts

# List skills in one domain
agent-library list artifacts --domain frontend

# Create a new manifest interactively
agent-library init ~/projects/new-app
```

---

## Day-to-day workflow

**Adding a new skill to the library:**

1. Create the skill directory under the appropriate domain in `~/.agent-library/`.
2. Add a `SKILL.md` with `name:` frontmatter matching the folder name.
3. Re-run sync for any project that includes that domain.
4. Commit to `~/.agent-library`.

**Updating an existing library skill:**

1. Edit the source in `~/.agent-library/<domain>/skills/<name>/SKILL.md`.
2. Re-run `agent-library sync <project>` for each affected project.
   - `generated` mode: target files update automatically.
   - `vendored` mode: only updates files you haven't locally edited.

**Using in CI (generated mode):**

```yaml
- run: agent-library sync .
  env:
    HOME_AGENT_LIBRARY: /path/to/shared-library   # if not ~/.agent-library on CI
```

Or use dry-run as a drift check:

```bash
agent-library sync --dry-run . | grep '\[dry-run\] would' && exit 1 || exit 0
```

---

## Summary table

| Skill location | Visible to Claude/Codex | Include syntax |
|---|---|---|
| `~/.agent-library/global/` synced to `~/` | Every project | `include: [global]` in `~/.agent-library.yml` |
| `~/.agent-library/frontend/` synced to a project | That project only | `include: [frontend]` in project `.agent-library.yml` |
| `<project>/.agent-library/product/skills/x/` | That project only | `include: [./product/skills/x]` in project `.agent-library.yml` |
