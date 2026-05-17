# Agent Library — Usage Guide

## What it is

`agent-library` syncs skills, commands, and agents from a GitHub repository into
the target directories that Claude and Codex actually read.

Neither Claude nor Codex reads the GitHub source directly. They read:

```
Claude:  ~/.claude/skills/            ← global, every project
         <project>/.claude/skills/    ← local, that project only

Codex:   ~/.agents/skills/            ← global, every project
         <project>/.agents/skills/    ← local, that project only
```

Until you sync, a skill in the library is invisible to both tools.

---

## How it works

The library source is a GitHub repository. Each manifest's `source` block names
the repo and ref to pull from:

```yaml
source:
  type: github
  repo: owner/my-agent-library
  ref: main
```

When you run `sync`, the CLI clones the repo at the pinned commit and
materialises the tree into a local cache at
`~/.cache/agent-library/trees/<sha>/`. Subsequent syncs against the same SHA
are instant cache hits. Use `sync --update` to advance to the latest remote
commit and re-pin.

---

## Setup

Install the binary and symlink it into PATH:

```bash
ln -sf ~/.agent-library-cli/bin/agent-library ~/.local/bin/agent-library
agent-library --version
```

To rebuild after changes:

```bash
cd ~/.agent-library-cli
bun run build
```

---

## Library structure

The source repository uses a domain-first layout:

```
<repo-root>/
  global/          — universal workflow skills (writing, TDD, security)
    agents/
    skills/
  frontend/        — React, UI, state management
    skills/
  backend/         — databases, server patterns
    agents/
    skills/
  fullstack/        — cross-stack concerns
    skills/
  agent-tools/     — meta skills for creating and judging other skills
    skills/
  profiles/        — named include bundles (optional)
```

The `global` domain is reserved for home-scoped manifests only (see below).

---

## Manifests

Every project that uses the library needs an `.agent-library.yml` manifest.

### Minimal project manifest

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

### Fields

| Field | Values | Notes |
|---|---|---|
| `version` | `1` | Required |
| `scope` | `project` (default) / `home` | `home` is required for global installs |
| `mode` | `generated` / `vendored` | Ownership model for target files |
| `target` | `both` / `claude` / `codex` | Which AI-config dirs to write into |
| `source.type` | `github` | Required |
| `source.repo` | `owner/name` | GitHub repository |
| `source.ref` | branch, tag, or SHA | Starting point for resolution |
| `include` | list of strings | Domains, paths, profiles, or local paths |

---

## Three levels of skill availability

### Level 1 — Global (every project)

Create `~/.agent-library.yml` with `scope: home` and sync into your home base:

```yaml
# ~/.agent-library.yml
version: 1
scope: home
mode: generated
target: both
source:
  type: github
  repo: owner/my-agent-library
  ref: main
include:
  - global
  - agent-tools
```

```bash
agent-library sync --global
```

Writes into `~/.claude/skills/` and `~/.agents/skills/`. Every project you open
will have these skills automatically. Only `scope: home` manifests may include
the `global` domain.

---

### Level 2 — Project skills from the library (one project only)

Create `.agent-library.yml` inside the project and sync:

```yaml
# ~/projects/my-app/.agent-library.yml
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
  - backend/skills/database-migrations
```

```bash
agent-library sync ~/projects/my-app
```

Writes into `~/projects/my-app/.claude/skills/` and
`~/projects/my-app/.agents/skills/`. Only visible when working inside that
project.

---

### Level 3 — Project-local skills (defined inside the project)

Use this for skills containing project-private knowledge: internal API
conventions, business rules, proprietary patterns.

**Directory structure:**

```
~/projects/my-app/
  .agent-library/              ← project's local source root
    product/
      skills/
        payments-flow/
          SKILL.md             ← frontmatter must include: name: payments-flow
  .agent-library.yml
```

**Reference with `./` in the manifest:**

```yaml
include:
  - frontend
  - ./product/skills/payments-flow   # resolves from .agent-library/ in the project
```

The `./` prefix tells the CLI to look in `<project>/.agent-library/`, not the
GitHub source tree. After sync, `payments-flow` appears alongside the library
skills in `.claude/skills/` and `.agents/skills/`.

---

## Sync modes

### generated (default)

The CLI owns the target files. Re-running sync overwrites them.

```yaml
mode: generated
```

Add `.claude/`, `.agents/`, and `.agent-library.lock` to `.gitignore` —
regenerate them on demand.

### vendored

You own the target files. The CLI only updates a file if its on-disk hash
matches the lockfile's previous hash (i.e. you haven't edited it locally).

```yaml
mode: vendored
```

Commit `.claude/`, `.agents/`, and `.agent-library.lock` — the files are yours
to modify.

---

## Private repositories

The CLI clones and fetches over HTTPS using the system `git` binary. There is no
built-in token flag — authentication is handled through git's existing credential
system. The three practical options are below.

### Option 1 — GitHub CLI (recommended for local use)

Install `gh` and authenticate once:

```bash
gh auth login
```

Follow the prompts to authenticate via browser or token. `gh` installs a git
credential helper that automatically supplies credentials whenever git contacts
`github.com`, so `agent-library sync` will just work.

To verify:

```bash
gh auth status
```

### Option 2 — Personal access token via git credential store

**Step 1 — Create a token**

Go to GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token.

Required permission: **Contents** → Read-only (on the target repository).

Copy the token value — GitHub shows it only once.

**Step 2 — Store it in git**

```bash
git config --global credential.helper store
```

Then trigger a clone of any private repo once (or run `agent-library sync` and
enter credentials when git prompts). Git stores the credentials in `~/.git-credentials`.

Alternatively, write the entry directly:

```
echo "https://<username>:<token>@github.com" >> ~/.git-credentials
```

### Option 3 — Token via environment variable (CI / headless)

For CI environments where you cannot use a credential helper, rewrite the HTTPS
URL to embed the token using git's `url.<base>.insteadOf` mechanism. Set this
in your CI environment:

```bash
git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
```

Or as a one-liner in a CI step:

```yaml
- name: Configure git credentials
  run: git config --global url."https://${{ secrets.GITHUB_TOKEN }}@github.com/".insteadOf "https://github.com/"

- name: Sync agent library
  run: agent-library sync .
```

The `GITHUB_TOKEN` secret is available automatically in GitHub Actions for
repositories the Actions runner has access to. For a private library repo in a
different org or a personal account, create a repository secret with a PAT that
has Contents: Read-only on the library repo.

---

## Commands

### `init` — Create a manifest

```bash
# Interactive — prompts for source, mode, target, and includes
agent-library init ~/projects/my-app

# Non-interactive — all required values passed as flags
agent-library init ~/projects/my-app --repo owner/my-agent-library --ref main

# Create a home-scoped manifest for global installs
agent-library init --global
agent-library init --global --repo owner/my-agent-library --ref main
```

`init` fetches the source tree (caching it for future runs) before showing the
include picker, so the picker reflects the exact contents of the repo. If GitHub
is unreachable, `init` falls back to free-text include entry.

**Flags:**

| Flag | Description |
|---|---|
| `--global` | Create a `scope: home` manifest for global AI-config dirs |
| `--repo owner/name` | GitHub repository (required in non-interactive mode) |
| `--ref <ref>` | Git ref: branch, tag, or SHA (required in non-interactive mode) |
| `--home <path>` | Override: use a local library tree instead of fetching (project init), or override the home base directory (--global init) |

---

### `sync` — Sync assets into a project

```bash
# Sync a specific project
agent-library sync ~/projects/my-app

# Sync the home-scoped manifest from the home base
agent-library sync --global

# Preview what sync would write without touching disk
agent-library sync --dry-run ~/projects/my-app

# Advance to the latest commit on the configured ref and re-pin
agent-library sync --update ~/projects/my-app
```

**Flags:**

| Flag | Description |
|---|---|
| `--global` | Sync the home manifest instead of a project manifest |
| `--dry-run` | Print the sync plan without writing files |
| `--update` | Fetch the latest remote state and update the pinned SHA in the lockfile |
| `--home <path>` | Override: use a local library tree instead of fetching (project sync), or override the home base directory (--global sync) |

---

### `validate` — Validate a manifest

```bash
# Full validation (requires a lockfile and network/cache access for the pinned SHA)
agent-library validate ~/projects/my-app

# Structural-only validation — no include resolution, no lockfile required
agent-library validate --no-resolve ~/projects/my-app
```

Full validation resolves includes against the pinned SHA from the lockfile. Run
`sync` first to produce a lockfile.

---

### `list` — Browse library contents

`list` reads the manifest and lockfile from the current directory to determine
which source tree to browse. Pass `--home` to target a local tree directly.

```bash
# List all domains in the library
agent-library list domains

# List available profiles
agent-library list profiles

# List all artifacts
agent-library list artifacts

# Filter by domain
agent-library list artifacts --domain frontend

# Filter by kind: skill, command, or agent
agent-library list artifacts --type skill
```

**Shared flag for all `list` subcommands:**

| Flag | Description |
|---|---|
| `--home <path>` | Use a pre-materialised library tree directly |

---

### `cache` — Manage the local cache

```bash
# Remove extracted trees not referenced by any active lockfile
agent-library cache prune
```

The cache lives at `~/.cache/agent-library/trees/<sha>/`. Pruning removes trees
whose SHA no longer appears in any known project's lockfile. Bare repos under
`~/.cache/agent-library/repos/` are not pruned.

---

## Day-to-day workflow

**First sync on a new machine:**

```bash
agent-library init ~/projects/my-app    # follow prompts; pays a one-time clone
agent-library sync ~/projects/my-app
```

**Adding a skill to the library repo:**

1. Push the skill to the GitHub source repo.
2. Run `agent-library sync --update <project>` to advance to the new commit.

**Updating an existing library skill:**

1. Merge the change to the configured ref in the source repo.
2. Run `agent-library sync --update <project>`.
   - `generated` mode: target files update automatically.
   - `vendored` mode: only files you haven't locally edited are updated.

**Using in CI (generated mode):**

```yaml
- run: agent-library sync .
```

Or use dry-run as a drift check:

```bash
agent-library sync --dry-run . | grep '\[dry-run\] would' && exit 1 || exit 0
```

For CI environments without network access to GitHub, point the CLI at a
pre-materialised tree with `--home` or the `HOME_AGENT_LIBRARY` env var
(project sync only; not honoured in `--global` mode):

```yaml
- run: agent-library sync .
  env:
    HOME_AGENT_LIBRARY: /path/to/shared-tree
```

---

## Summary table

| Skill location | Visible to Claude/Codex | Include syntax |
|---|---|---|
| GitHub source → synced to `~/` with `--global` | Every project | `include: [global]` in `~/.agent-library.yml` (scope: home) |
| GitHub source → synced to a project | That project only | `include: [frontend]` in project `.agent-library.yml` |
| `<project>/.agent-library/product/skills/x/` | That project only | `include: [./product/skills/x]` in project `.agent-library.yml` |
