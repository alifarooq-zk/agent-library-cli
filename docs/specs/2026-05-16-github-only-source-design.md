# GitHub-Only Source (v1.0) — Design

## Summary
Make GitHub the single canonical source for all assets by requiring `source` in manifests, introducing a home-scoped global install path, and removing the local fallback. Add `--global` to `init` and `sync`, plus repo/ref capture in init (interactive or flags).

## Goals
- Require `source` in all manifests.
- Support a home-scoped manifest/lockfile and home target directories.
- Preserve `--home`/`HOME_AGENT_LIBRARY` as path overrides only.
- Keep `sync` deterministic and manifest-driven.
- Improve init UX by capturing GitHub repo/ref.

## Non-Goals
- New sync override flags (repo/ref overrides at runtime).
- Changing cache or lockfile schema.

Existing `~/.agent-library/` checkouts are preserved (the directory is no longer canonical, but it keeps a real role as a library author's dev checkout — see "library tree" / `--home` semantics). No migration step is required.

## Decisions
- **Home scope:** `scope: home` is the canonical term; avoid “global scope”/“user scope.”
- **`--home` flag (overloaded by subcommand):**
  - On `sync <project>` and `init <project>`: points at a pre-materialised **library tree**; bypasses `resolveSource()` (no GitHub fetch). `source` is still required by schema. For `sync`, the lockfile's `source` block from any prior sync is preserved. Honours `HOME_AGENT_LIBRARY` as a fallback.
  - On `sync --global` and `init --global`: overrides the **home base** (the dir under which the home manifest, lockfile, `.claude`, and `.agents` live). Does **not** bypass GitHub fetch — source resolution still runs.
  - The two jobs are disjoint per subcommand, so a single flag is unambiguous. `HOME_AGENT_LIBRARY` is **not** consulted in `--global` mode.
- **`sync --global` behavior:** Ignores any project root, uses home paths exclusively, and fails fast if scope ≠ `home`.
- **Global domain restriction:** Enforced in both `validateManifest` and `validateResolvedArtifactsScope`; applies only when `scope !== home`.
- **Source type:** `source.type` must be `github` (schema enforces literal).
- **Source fields:** `source.repo` and `source.ref` are required by schema with explicit errors.
- **Missing source:** Fails during schema parse after manifest read, before sync pipeline I/O.
- **Home paths:** Manifest/lockfile/targets always derived from `resolveHomePaths()` (including overrides).
- **Init overwrite guard:** Prompt in interactive mode; fail with clear error in non-interactive mode.
- **Init source capture:** `init` and `init --global` prompt for repo/ref; non-interactive requires `--repo` and `--ref` flags.
- **Repo validation:** `owner/name` format enforced during init.
- **Init materialises on-demand:** After repo/ref are captured, `init` runs `resolveSource()` to materialise the library tree before showing the include picker, so the picker reflects the exact tree the user will sync against. First init pays a one-time clone; subsequent inits against the same SHA hit the cache. `--home <local-tree>` skips the fetch (library-tree job).
- **Init offline fallback:** If source materialisation fails with a network error, init falls back to free-text include input (no picker) and still writes the manifest. The next `sync` retries source resolution.
- **`list` is manifest-aware:** Defaults to the project's lockfile-pinned SHA. Falls back to manifest `ref` (HEAD) with a warning if no lockfile. Errors if no manifest and no `--home`.
- **`validate` requires a lockfile for include-resolution:** No more `resolveHomeRoot()` fallback. `--no-resolve` opts out of include-resolution for pre-sync validation.
- **Lockfile source preserved under `--home`:** A `sync <project> --home <local-tree>` run does not resolve a SHA, so it has no `LockfileSource` of its own. The implementation reads the existing lockfile's `source` block (if any) and carries it forward into the new lockfile unchanged. A project that has never sync'd against GitHub legitimately produces a lockfile with no `source` block. Rationale: dev-loop `--home` runs must not silently destroy provenance from prior real syncs.
- **ADR:** Add an ADR documenting the GitHub-only source requirement (covers both schema enforcement and init's network dependency).

## Architecture Overview

### Components
- **`src/manifest/schema.ts`**
  - Make `source` required and enforce `source.type/repo/ref` with user-friendly errors.
- **`src/manifest/validate.ts`**
  - Remove `manifest.source` exemption from global-domain guards.
- **`src/util/home.ts`**
  - Add `resolveHomePaths(platform?, env?)` returning manifest/lockfile/targets.
- **`src/commands/init.ts`**
  - Add `--global`, `--repo`, `--ref` flags.
  - Prompt for repo/ref in interactive mode.
  - Require repo/ref flags in non-interactive mode.
- **`src/commands/sync.ts`**
  - Add `--global` and home-path entry point.
  - Remove local fallback branch.
- **`src/commands/list.ts`**
  - Drop the implicit `resolveHomeRoot()` default. Resolve a tree from `--home`, or from the project's lockfile-pinned SHA, or from the manifest's `ref` (HEAD) with a warning. Error if none of those are available.
- **`src/commands/validate.ts`**
  - Replace `resolveHomeRoot()` with lockfile-pinned SHA materialisation for include-resolution validation. Add `--no-resolve` to opt out (structural validation only). Error if neither flag nor lockfile is available.

### Data Flow

**`init --global` (interactive)**
```
resolveHomePaths()
→ ensure manifest absent
→ prompt repo/ref
→ validate repo format
→ resolveSource() to materialise library tree (or fall back to free-text on network failure)
→ prompt mode/target
→ show include picker against materialised tree
→ write manifest (scope: home + source)
```

**`init` (interactive, project)** — same flow as above without `scope: home`.

**`init` (non-interactive)**
```
stdin/defaults + require --repo/--ref
→ validate repo format
→ resolveSource() to materialise (cache hit expected for repeat runs; non-fatal network failure → free-text path)
→ write manifest
```

**`sync --global`**
```
resolveHomePaths()
→ load home manifest
→ validate schema (source required)
→ ensure scope === home
→ resolve source + include
→ validate scope
→ build plan
→ write to home targets
```

**`sync <project-root>`**
```
load manifest
→ validate schema
→ resolve source (required)
→ resolve include
→ validate scope
→ build plan
→ write to project targets
```

## Error Handling
- **Missing `source`:** `error: source is required; add a source block with type, repo, and ref`
- **Missing `source.repo`/`source.ref`:** explicit schema errors (repo required in `owner/name` format; ref required).
- **`sync --global` missing manifest:** `error: no home manifest found at <path>; run \`agent-lib init --global\` to create one`
- **`sync --global` wrong scope:** clear error indicating scope must be `home`.
- **Global domain misuse (scope ≠ home):** `GLOBAL_RESERVED_MESSAGE` (unchanged).
- **Invalid repo format:** friendly init-time error (owner/name required).

## Testing Plan

### Unit
- `resolveHomePaths()` for Windows and Linux/macOS branches (mock platform/env).
- Manifest schema: `source` required; error message correctness.
- Global domain restriction: `scope: project` with `global/` include fails.

### Integration
- `init --global` creates home manifest with `scope: home` and source fields.
- Non-interactive `init` requires `--repo`/`--ref`.
- First-ever `init` materialises the source tree and shows the picker; second `init` against the same SHA hits the cache and skips network.
- `init` with a forced network failure falls back to free-text include input and still writes the manifest.
- `init --home <local-tree>` skips the fetch and uses the override directly.
- `sync --global` uses home manifest/targets; fails if manifest missing or scope != home.
- `sync <project-root>` continues to work with valid `source`.

## Open Items
- Write five ADRs (0011–0015) per the plan's Task 8: GitHub-only source, `--home` subcommand overload, init on-demand materialisation, `list`/`validate` manifest-awareness, and lockfile source preservation under `--home`.
