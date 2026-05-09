# Ubiquitous Language

Date: 2026-05-08
Status: Draft

This document defines the domain language used by the agent library standard, implementation plan, CLI, tests, and documentation.

## Core Terms

**Agent library**
: The canonical Git-versioned repository at `~/.agent-library`. It contains source assets, profiles, CLI source code, tests, and documentation.

**Source asset**
: A neutral skill, slash command, or subagent stored in the canonical library or in a project-local `.agent-library` directory.

**Target directory**
: A generated or vendored deployment directory consumed by an agent harness. Version 1 supports `.agents` and `.claude`.

**Install target**
: The root directory being synced. It contains `.agent-library.yml` and receives `.agents`, `.claude`, and `.agent-library.lock`.

**Manifest**
: The `.agent-library.yml` file at an install target root. It declares `version`, `mode`, `target`, and `include`.

**Lockfile**
: The `.agent-library.lock` file written by sync. It records original includes, expanded artifacts, target paths, hashes, adapter hashes, CLI version, and sync time.

**Artifact**
: A unit the library can install. Version 1 supports skills, slash commands, and subagents.

**Artifact ID**
: A domain-qualified source path such as `frontend/skills/react-useeffect` or `global/agents/security-reviewer`.

**Domain**
: The first path segment of a source asset, such as `global`, `frontend`, `backend`, `database`, or `monorepo`.

**Global domain**
: The `global` domain. It is reserved for universal workflow assets. Global does not mean automatic.

**Profile**
: A named include list stored under `~/.agent-library/profiles`. Manifests reference profiles with `profile:<name>`.

**Bundle**
: A directory include such as `global` that expands to every supported artifact under that directory.

**Adapter**
: Optional target-specific markdown appended after the neutral source content. Adapters are additive notes, not complete forks.

**Generated file**
: A target file written in `mode: generated`. It has a generated header and may be overwritten or cleaned up by sync when safe.

**Vendored file**
: A target file written in `mode: vendored`. It has a vendored header and may be committed to the project. Sync updates it only when the previous lockfile proves the file has not been locally edited.

**Collision**
: A case where two included artifacts map to the same flattened target path. Version 1 fails validation instead of aliasing or overriding.

## Manifest Terms

**`version`**
: The manifest schema version. Version 1 requires `version: 1`.

**`mode`**
: The ownership mode. Allowed values are `generated` and `vendored`.

**`target`**
: The target directory selection. `codex` writes `.agents`, `claude` writes `.claude`, and `both` writes both.

**`include`**
: A non-empty list of profile references, artifact paths, bundle paths, or project-local paths.

**Bare include**
: An include such as `frontend/skills/react-useeffect`. Bare includes resolve from `~/.agent-library`.

**Project-local include**
: An include beginning with `./`. These resolve from `<install target>/.agent-library`.

**Profile include**
: An include beginning with `profile:`. These resolve from `~/.agent-library/profiles`.

## Artifact Terms

**Skill**
: A folder under `<domain>/skills/<name>` with a required `SKILL.md`. The `name:` field in frontmatter must match the folder basename.

**Slash command**
: A markdown file under `<domain>/commands/<name>.md`. The standard also allows existing singular `command/` folders for compatibility, but new packages should use `commands/`.

**Subagent**
: A markdown file under `<domain>/agents/<name>.md`.

**Neutral source**
: The source body that should work across agent harnesses before adapter text is appended.

**Target name**
: The basename used in flattened target paths. For `frontend/skills/react-useeffect`, the target name is `react-useeffect`.

## Pipeline Terms

**Load manifest**
: Read `.agent-library.yml` as structured YAML.

**Validate**
: Check required fields, supported values, resolvable includes, profile rules, artifact structure, adapter names, frontmatter, collisions, and mode-specific ownership safety.

**Resolve includes**
: Convert manifest includes into concrete artifact descriptors.

**Expand profiles**
: Replace `profile:<name>` entries with the profile's include list. Version 1 rejects nested profiles.

**Expand bundles**
: Replace directory includes with the supported artifacts found under that directory.

**Build plan**
: Compute the exact source files, adapter files, target files, mode, and target directories before writing anything.

**Detect collisions**
: Check planned target paths for duplicates before sync writes files.

**Write sync output**
: Write generated or vendored target files according to the selected mode.

**Update lockfile**
: Record the resolved install state after sync.

**Stale cleanup**
: In generated mode, delete previously generated files that are no longer included, but only when they are marked as agent-library generated files.

## Reserved Meanings

`.agents` is the generic target for Codex, Copilot-style agents, Gemini-style agents, and other compatible harnesses.

`.claude` is the Claude target.

`.agent-library` under a project is a local source directory, not a target.

`.agent-library.yml` is a manifest.

`.agent-library.lock` is a resolved sync record.

