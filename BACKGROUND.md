# Background

Date: 2026-05-08
Status: Draft

## Problem

Agent assets are currently easy to duplicate and hard to govern.

Claude Code, Codex, Copilot-style agents, and Gemini-style agents can all consume similar skills, slash commands, and subagents, but their target directories differ. Without a canonical library, the same asset can drift between `.claude`, `.agents`, and project-local copies. A fix in one place may not reach the others. A project can also lose track of whether an asset is generated, vendored, or hand-authored.

The result is operational friction:

- Reusable agent assets are copied by hand.
- `.claude` and `.agents` can become competing sources of truth.
- Project installs cannot clearly state which skills, commands, and subagents they depend on.
- Target directories can be overwritten or cleaned up unsafely.
- Locally edited vendored assets can be lost without a lockfile-based ownership check.
- Domain-specific assets can leak into the global workflow set.

## Desired Outcome

The agent library should provide one Git-versioned source of truth at `~/.agent-library`.

Projects and the home environment should opt into assets through a manifest. The CLI should resolve that manifest, expand profiles and bundles, generate target-compatible files, and record the resolved state in a lockfile.

The important outcome is not only file copying. The system must make ownership explicit:

- Source assets live in `~/.agent-library` or a project-local `.agent-library`.
- `.agents` and `.claude` are deployment targets, not sources of truth.
- Generated files are owned by the sync tool.
- Vendored files are owned by the project but retain source provenance.
- Lockfiles record the exact resolved install state.

## Scope

Version 1 implements a TypeScript CLI in the canonical library repository. It supports:

- Manifest validation.
- Listing domains, profiles, and artifacts.
- Generated sync.
- Vendored sync with local-edit protection.
- Project-local `./` includes.
- Interactive manifest initialization.
- Dry-run output for sync plans.

Version 1 does not migrate existing `.agents` or `.claude` content. It also does not support nested profiles, aliases for collision resolution, implicit installs, or automatic `.gitignore` editing.

## Why This Matters

The library is intended to become shared infrastructure for agentic work. That means correctness matters more than convenience shortcuts.

The CLI must be predictable, non-destructive, and testable. Every project should be able to answer four questions:

1. Which agent assets are installed?
2. Where did each asset come from?
3. Which files will sync overwrite?
4. Which local edits will sync preserve?

The standard and implementation plan answer those questions through explicit manifests, generated and vendored modes, target markers, collision checks, and lockfile hashes.

