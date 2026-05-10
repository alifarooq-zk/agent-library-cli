# Global Domain Project Restriction

Date: 2026-05-10
Status: Approved

## Problem

When a user runs `agent-library init` inside a project directory, the `global` domain appears as a selectable include option. Selecting it causes global skills to sync into the project's `.agents/` and `.claude/` directories.

This is wrong. The Claude Code harness merges skills from both `~/.claude/skills/` (global) and `./.claude/skills/` (project-local). Global skills are already visible inside every project. Syncing them into `./.claude/skills/` creates redundant copies that can drift out of sync with the source. The same applies to agents in `~/.agents/` vs `./.agents/`.

## Decisions

### 1. `global` is a home-only domain

`global` is the only reserved domain. It may appear only in the home manifest (`~/.agent-library.yml`). Project manifests must not include it.

No other domains are restricted in v1.

### 2. `scope` field in the manifest schema

Add an optional `scope` field to the manifest schema:

```yaml
scope: "home" | "project"
```

- Absent or `"project"`: standard project manifest. `global` in `include` is a hard error.
- `"home"`: home-level manifest. `global` in `include` is permitted.

This field makes the manifest self-describing. `sync` and `validate` read it without inferring anything from the file path.

### 3. `--global` flag on `init`

`init` adds a `--global` flag. Without it, `global` is filtered from the include selection UI entirely. With it, `global` appears as a selectable option and `init` writes `scope: home` to the manifest.

Path inference (comparing `projectRoot` to `os.homedir()`) was considered and rejected: it breaks for non-standard home paths and is implicit. An explicit flag is clearer.

### 4. Hard error in `sync` and `validate`

If a manifest has `scope: "project"` (or no `scope`) and `include` contains `"global"`, both `sync` and `validate` exit with a hard error:

```
error: "global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.
```

### 5. No migration

The tool is pre-release. Existing manifests that include `global` without `scope: home` will fail `sync` after this change. Users must re-run `init` with the appropriate flags. No backward compatibility shim is needed.

## Compatibility with GitHub Source of Truth

The GitHub Source of Truth design (docs/plans/2026-05-09-github-source-of-truth-design.md) introduces a `source` block and changes `homeRoot` to a cache-extracted tree path. This does not affect the restriction.

- The `--global` flag controls the `init` UI layer.
- `scope` is read by `sync` from the manifest, independent of source type.
- The `include` array is unchanged in the GitHub model.
- The two features are orthogonal.

## Changeset

| File                       | Change                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/manifest/schema.ts`   | Add optional `scope: "home" \| "project"`, default `"project"`                                               |
| `src/commands/init.ts`     | Add `--global` flag; filter `global` from `buildIncludeGroups` when absent; write `scope: home` when present |
| `src/manifest/validate.ts` | Hard error if `include` contains `"global"` and `scope !== "home"`                                           |
| `src/commands/sync.ts`     | Picks up the error automatically via the validate step                                                       |
