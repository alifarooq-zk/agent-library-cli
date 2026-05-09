# Agent Library Standard

Date: 2026-05-08
Status: Draft

## Purpose

This standard defines one canonical, Git-versioned source of truth for agent skills, slash commands, and subagents used across Claude Code, Codex, Copilot-style agents, and Gemini-style agents.

The system must remove duplicate hand-maintenance between `.claude` and `.agents` without making either directory canonical. `.claude` and `.agents` are deployment targets only. The canonical source is `~/.agent-library`.

## Goals

- Keep one neutral source of truth for reusable agent assets.
- Support both user-level and project-level installs.
- Keep global user assets limited to universal workflow tools.
- Let projects opt into frontend, backend, database, monorepo, or domain-specific assets as needed.
- Generate Claude and Codex-compatible target directories from the same neutral source.
- Support both generated and vendored project installs.
- Preserve portability when a project needs committed copies of selected assets.
- Prevent silent overwrites, collisions, and drift.

## Non-Goals

- Do not migrate existing `.agents` or `.claude` content as part of this spec.
- Do not keep or support a `.agent` directory. That was a typo; the standard uses `.agents`.
- Do not make `.agents` or `.claude` a source of truth.
- Do not automatically infer install mode, target, or included assets.
- Do not automatically install global skills into every project.
- Do not support nested profiles in the first version.

## Canonical Repository

The canonical library lives at:

```text
~/.agent-library
```

This directory must be a Git repository. It contains source assets, profiles, the TypeScript CLI, documentation, and tests.

The repository contains both the universal workflow set and the optional catalog. The universal workflow set lives under the `global` domain. Optional project assets live under other domains such as `frontend`, `backend`, `database`, and `monorepo`.

No asset installs implicitly. Home and project manifests must opt into every profile, bundle, or artifact they want.

Daily usage should support both:

```bash
cd ~/.agent-library
bun run src/cli.ts sync <path>
```

and the compiled command:

```bash
agent-library sync <path>
```

The CLI should be implemented in TypeScript because most target projects are TypeScript projects.

Development uses Bun as the runtime, package manager, test runner, and executable compiler. End users should not need Bun installed for normal use. Version 1 ships a current-platform standalone executable built with Bun's compile target. On the current implementation machine, that target is `bun-linux-x64`.

The implementation stack is:

- Bun for development, tests, dependency management, and executable compilation.
- TypeScript for source code.
- Commander for command routing and help output.
- `@clack/prompts` for interactive `init` flows.
- Zod for manifest, lockfile, CLI input, and structured validation.
- `yaml` for manifest and lockfile YAML parsing and writing.
- Chalk for terminal colors.
- Node-compatible `crypto` APIs for hashing.

`sync`, `validate`, and `list` must remain non-interactive. `sync` may overwrite only generated files that contain the agent-library generated marker. `init` is interactive by default.

## Target Directories

The sync tool writes to these target directories:

```text
.agents
.claude
```

`target: codex` writes `.agents`.

`target: claude` writes `.claude`.

`target: both` writes both.

The `.agents` target is the generic target for Codex, Copilot-style agents, Gemini-style agents, and other harnesses that use `.agents`.

## Artifact Types

The library manages three artifact types:

- Skills
- Slash commands
- Subagents

Installing a package installs all files that belong to that package, including bundled commands, adapters, assets, references, prompts, and helper files.

Standalone commands and subagents can also be included directly.

## Source Layout

The source layout is domain-first.

```text
~/.agent-library/
  global/
    skills/
      writing-plans/
        SKILL.md
        adapters/
          claude.md
          codex.md
      humanizer/
        SKILL.md
    commands/
      review-pr.md
    agents/
      security-reviewer.md

  frontend/
    skills/
      react-useeffect/
        SKILL.md
      shadcn/
        SKILL.md
        commands/
          add-component.md

  backend/
    skills/
      api-design/
        SKILL.md

  database/
    skills/
      postgres-patterns/
        SKILL.md

  monorepo/
    skills/
      turborepo/
        SKILL.md
        commands/
          turborepo.md

  profiles/
    universal.yml
    frontend.yml
    backend.yml

  bin/
    agent-library

  docs/
    specs/
```

The exact domain names can evolve, but each manifest entry must use the domain-qualified path.

## Global Assets

The `global` domain is reserved for universal workflow assets only.

Global assets should be useful across frontend, backend, database, infrastructure, writing, planning, and review work. Examples include:

- `global/skills/writing-plans`
- `global/skills/writing-clearly-and-concisely`
- `global/skills/humanizer`
- `global/skills/skill-judge`
- `global/skills/git-workflow`
- `global/skills/security-review`
- `global/skills/tdd`

Framework-specific, database-specific, monorepo-specific, or tool-specific assets do not belong in `global`. They belong in domains such as `frontend`, `backend`, `database`, `monorepo`, or another specific domain.

Global does not mean automatic. To install the global set, a manifest must include `global` or a profile that expands to `global`.

## Project-Level Sources

A project may define neutral local assets under:

```text
<repo>/.agent-library
```

Local project assets follow the same source format as home library assets.

Example:

```text
<repo>/.agent-library/
  product/
    skills/
      domain-review/
        SKILL.md
    agents/
      domain-reviewer.md
    commands/
      release-check.md
```

Project manifests may include local assets with `./` paths.

```yaml
include:
  - ./product/skills/domain-review
  - ./product/agents/domain-reviewer
```

Resolution rules:

- `profile:<name>` resolves from `~/.agent-library/profiles/<name>.yml`.
- Bare paths resolve from `~/.agent-library`.
- `./...` paths resolve from the current project's `.agent-library`.

Local source assets must not live directly inside `.agents` or `.claude`, because those directories are targets.

## Manifest

Every install target, including the home directory, uses a manifest.

Home manifest:

```text
~/.agent-library.yml
```

Project manifest:

```text
<repo>/.agent-library.yml
```

The manifest lives at the root of the install target. It does not live inside `.agents` or `.claude`.

All core fields are required.

```yaml
version: 1
mode: generated
target: both
include:
  - profile:universal
  - frontend/skills/react-useeffect
  - ./product/skills/domain-review
```

### Manifest Fields

`version` must be `1`.

`mode` must be one of:

- `generated`
- `vendored`

`target` must be one of:

- `codex`
- `claude`
- `both`

`include` must be a non-empty list of profile references, artifact paths, or bundle paths.

There are no defaults. The CLI must refuse to sync when a required field is missing.

## Include Paths

Manifest entries mirror source paths.

Examples:

```yaml
include:
  - global/skills/writing-plans
  - global/agents/security-reviewer
  - frontend/skills/react-useeffect
  - monorepo/skills/turborepo
  - profile:frontend
```

An include path may point to a concrete artifact or a bundle directory.

If an include points to a directory such as:

```yaml
include:
  - global
```

the CLI expands it to every supported artifact under that directory.

The lockfile must record the expanded artifact list, not only the bundle path.

## Profiles

Profiles live in:

```text
~/.agent-library/profiles
```

A profile is a named include list.

Example:

```yaml
include:
  - global
  - frontend/skills/react-useeffect
  - frontend/skills/shadcn
```

Manifests reference profiles with:

```yaml
include:
  - profile:frontend
```

Profiles may include artifact paths and bundle paths.

Profiles must not include other profiles in version 1. The CLI must reject nested profile references.

The lockfile must expand profiles into exact artifact paths.

## Agent-Neutral Source

Source assets are agent-neutral by default. They should not assume Claude-specific or Codex-specific behavior unless that behavior is isolated in an adapter.

Skills use a neutral `SKILL.md`.

```text
frontend/skills/react-useeffect/
  SKILL.md
  adapters/
    claude.md
    codex.md
```

Adapter files are optional.

When generating a target artifact, the CLI combines:

1. the generated or vendored header,
2. the neutral source file,
3. the target-specific adapter text, when present.

Adapters are additive notes. They should not fork the whole skill unless a future version explicitly supports full variants.

## Generated Headers

Generated files must include a header that marks them as owned by the sync tool.

Example:

```md
<!--
Generated by agent-library.
Source: frontend/skills/react-useeffect
Mode: generated
Do not edit this file directly. Edit the source in ~/.agent-library or the project .agent-library source.
-->
```

The CLI may overwrite generated files that contain its marker.

During cleanup, the CLI may delete files it previously generated if they are no longer listed in the manifest. It must not delete unmarked local files.

## Vendored Headers

Vendored files must include provenance and fork information.

Example:

```md
<!--
Vendored from agent-library.
Source: frontend/skills/react-useeffect
Mode: vendored
This project owns this copy. Local edits are allowed.
The sync tool will update it only if it is unchanged from the last recorded source.
-->
```

Vendored assets are portable and may be committed to the project.

Normal sync must not overwrite locally edited vendored files. Vendored updates follow the lockfile rules below.

## Generated Mode

In `mode: generated`, the CLI:

- reads the manifest,
- resolves profiles and bundles,
- writes target files into `.agents`, `.claude`, or both,
- adds generated headers,
- updates the lockfile,
- removes stale generated files that are no longer included,
- preserves unmarked local files.

Generated target files are build artifacts. Projects should usually ignore them in Git.

Recommended ignore entries for generated mode:

```gitignore
.agents/skills/
.agents/commands/
.agents/agents/
.claude/skills/
.claude/commands/
.claude/agents/
.agent-library.lock
```

Projects may choose more precise ignore rules if they keep hand-authored files in the same target directories.

## Vendored Mode

In `mode: vendored`, the CLI:

- reads the manifest,
- resolves profiles and bundles,
- copies target files into `.agents`, `.claude`, or both,
- adds vendored headers,
- updates the lockfile,
- updates vendored files only when they are unchanged from the last recorded source,
- refuses to overwrite locally edited vendored files.

Vendored target files and `.agent-library.lock` should be committed.

Recommended committed files for vendored mode:

```text
.agent-library.yml
.agent-library.lock
.agents/**
.claude/**
```

Vendored mode exists for projects that need to work without the user's home `~/.agent-library`.

## Lockfile

Each sync creates or updates:

```text
.agent-library.lock
```

The lockfile records the exact resolved state of an install. It must include:

- manifest version,
- mode,
- target,
- original include entries,
- expanded artifact paths,
- source path for each artifact,
- target paths for each artifact,
- source hash,
- generated or vendored target hash,
- adapter state for each target, recorded as `none` or as an applied adapter source and hash,
- sync timestamp,
- CLI version.

Generated mode lockfiles are usually ignored.

Vendored mode lockfiles should be committed.

Vendored update behavior depends on the lockfile:

- If the target file hash matches the previous lockfile target hash, the CLI may update it to the new source.
- If the target file hash differs, the CLI must treat the file as locally edited and refuse to overwrite it.
- The CLI should report the changed file and the source artifact that wants to update it.

## Target Path Mapping

Source paths are domain-qualified, but target paths are flattened for harness compatibility.

Example source:

```text
frontend/skills/react-useeffect
```

Generated target:

```text
.agents/skills/react-useeffect/
.claude/skills/react-useeffect/
```

Source:

```text
global/agents/security-reviewer.md
```

Generated target:

```text
.agents/agents/security-reviewer.md
.claude/agents/security-reviewer.md
```

The source folder or file basename is the canonical target name.

For a skill:

```text
frontend/skills/react-useeffect/SKILL.md
```

the canonical target name is:

```text
react-useeffect
```

The `name:` field in `SKILL.md` frontmatter must match the folder basename.

## Collision Rules

Because target paths are flattened, collisions are possible.

Example:

```yaml
include:
  - testing/skills/review
  - security/skills/review
```

Both would write:

```text
.agents/skills/review/
```

The CLI must fail validation when two included artifacts map to the same target path.

No aliasing is supported in version 1.

Later includes must not override earlier includes.

## Commands

Commands may be standalone or bundled with a skill.

Standalone command source:

```text
global/commands/review-pr.md
```

Target:

```text
.agents/commands/review-pr.md
.claude/commands/review-pr.md
```

Bundled skill command source:

```text
monorepo/skills/turborepo/commands/turborepo.md
```

When `monorepo/skills/turborepo` is included, the command is installed with the skill.

The standard should support both `commands/` and the existing singular `command/` folder for compatibility, but new source packages should use `commands/`.

## Subagents

Subagents live under a domain's `agents` directory.

Example:

```text
global/agents/security-reviewer.md
```

Target:

```text
.agents/agents/security-reviewer.md
.claude/agents/security-reviewer.md
```

Subagents may use adapters if target-specific wording is needed.

Example:

```text
global/agents/security-reviewer.md
global/agents/security-reviewer.adapters/
  claude.md
  codex.md
```

The exact adapter file layout for standalone markdown artifacts may be refined during implementation, but it must preserve the same rule: neutral source first, additive target-specific notes second.

## Validation

The CLI must provide:

```bash
agent-library validate <path>
```

Validation must check:

- manifest file exists,
- `version`, `mode`, `target`, and `include` are present,
- `version` is supported,
- `mode` is `generated` or `vendored`,
- `target` is `codex`, `claude`, or `both`,
- include entries resolve,
- profile references resolve,
- profiles do not include other profiles,
- bundles expand to supported artifacts,
- artifacts have valid structure,
- skill `SKILL.md` exists,
- skill frontmatter `name:` matches folder basename,
- target path collisions do not exist,
- adapter files use supported names,
- vendored updates do not overwrite locally edited files,
- generated cleanup touches only marked files.

## Listing

The CLI must provide:

```bash
agent-library list
```

Useful list modes:

```bash
agent-library list domains
agent-library list profiles
agent-library list artifacts
agent-library list artifacts --domain frontend
agent-library list artifacts --type skills
```

The list command should show source IDs exactly as manifests use them.

## Sync

The CLI must provide:

```bash
agent-library sync <path>
```

The path points to the home directory or a project root containing `.agent-library.yml`.

Examples:

```bash
agent-library sync ~
agent-library sync ~/Documents/Workspace/hcpa/app
```

The sync command must:

1. load the manifest,
2. validate it,
3. resolve profiles,
4. expand bundles,
5. detect collisions,
6. compute source and adapter hashes,
7. write generated or vendored files,
8. clean stale generated files when safe,
9. update `.agent-library.lock`,
10. print a concise summary.

## Summary Output

The sync command should report:

- target root,
- mode,
- target,
- number of installed skills,
- number of installed commands,
- number of installed subagents,
- stale generated files removed,
- vendored files skipped because of local edits,
- lockfile path.

Example:

```text
Agent library sync complete
Root: /home/alifarooq/Documents/Workspace/example
Mode: generated
Target: both
Skills: 8
Commands: 2
Agents: 1
Removed stale generated files: 3
Lockfile: .agent-library.lock
```

## Error Behavior

The CLI should fail fast on structural errors.

It must not partially sync after validation fails.

For vendored local edits, the CLI should leave files unchanged and report the exact conflict.

For generated stale files, the CLI may delete only files that contain the generated marker and are recorded in the lockfile or recognizable as agent-library generated files.

## First Migration Strategy

This spec does not perform migration, but it defines a future migration path:

1. Create the TypeScript CLI in `~/.agent-library`.
2. Add initial profiles.
3. Move universal workflow assets into `~/.agent-library/global`.
4. Move optional assets into domain-specific directories.
5. Create `~/.agent-library.yml` for home-level install.
6. Run validation.
7. Run sync in generated mode for the home directory.
8. Review `.agents` and `.claude` output.
9. Add project manifests one project at a time.

Potential initial universal assets:

- `writing-plans`
- `writing-clearly-and-concisely`
- `humanizer`
- `skill-judge`
- `git-workflow`
- `security-review`
- `tdd`
- `grill-me`
- `brainstorming`

Potential optional catalog domains:

- `frontend`
- `backend`
- `database`
- `monorepo`
- `react`
- `writing`
- `career`
- `architecture`

The final migration set should be reviewed before files are moved.

## Implementation Decisions

These decisions are locked for version 1:

- YAML parser: `yaml`.
- CLI packaging: Bun development workflow with a current-platform standalone executable.
- Generated mode ignore rules: documented only.
- Standalone markdown adapter convention: consistent `<name>.adapters/` directories.
- Dry run before sync: supported.
- `agent-library init`: supported and interactive by default with `@clack/prompts`.

The exact lockfile schema is implementation-defined, but it must satisfy the lockfile requirements in this standard.

These are implementation details. They do not change the architecture decisions recorded in this spec.
