# Context

Date: 2026-05-17
Status: Draft

This document summarizes the important decisions behind the agent library CLI plan. ADRs hold the formal decision records; this file gives implementers a single narrative view.

## Language

**Home scope**:
A manifest scope that targets the user's home directories for outputs and is the only scope allowed to include `global` domain assets.
_Avoid_: global scope, user scope

**Library tree**:
A materialised directory of source assets at a known SHA. Normally populated by `resolveSource()` under the cache root from a GitHub repo; in dev/test runs of `sync <project>` it can be substituted with a local directory via `--home`.
_Avoid_: home root, source tree

**Home base**:
The directory under which the home manifest (`.agent-library.yml`), home lockfile (`.agent-library.lock`), and home target dirs (`.claude`, `.agents`) live. Defaults to the OS home directory; overridable in `--global` subcommands via `--home`.
_Avoid_: home dir, home root

## Current Direction

The canonical agent library is a GitHub repository named by each manifest's `source` block. `resolveSource()` materialises a pinned SHA into the cache (`~/.cache/agent-library/trees/<sha>/`) before sync runs. `~/.agent-library/` is no longer canonical — it is a conventional location for **library authors' local checkouts** and is not consulted unless a subcommand is explicitly pointed at it via `--home`. The CLI lives in the same GitHub repository as the canonical assets.

Install targets opt into assets with `.agent-library.yml`. Sync resolves the manifest, expands profiles and bundles, detects collisions, writes `.agents` and `.claude`, and records the resolved state in `.agent-library.lock`.

Version 1 treats `.agents` and `.claude` as output directories only. They are never canonical sources.

## Important Decisions

- The canonical library is a GitHub repository named by each manifest's `source` block. `~/.agent-library/` is a conventional path for library authors' local checkouts only; never consulted by default.
- Global installs use `scope: home` in manifests.
- `--home` only overrides paths; `source` remains required.
- `sync --global` ignores any project root and uses home paths exclusively.
- `init --global` prompts before overwriting an existing home manifest in interactive mode; fails with a clear error in non-interactive mode.
- Global domain restrictions are enforced in both `validateManifest` and `validateResolvedArtifactsScope`.
- `sync --global` missing-manifest error uses the PRD-specified message including path and `init --global` suggestion.
- `resolveHomePaths(platform?, env?, override?)` accepts optional overrides and defaults to `process.platform` and `process.env`.
- `--home` is overloaded by subcommand. On `sync <project>` / `init <project>` it is the **library tree** (skip GitHub fetch). On `sync --global` / `init --global` it is the **home base** (override the directory holding the home manifest, lockfile, and target dirs). The two jobs are disjoint per subcommand.
- `HOME_AGENT_LIBRARY` is honoured only for the library-tree job (i.e. `sync <project>` and `init <project>`). It is **not** consulted in `--global` mode.
- `init` materialises the source tree on demand (via `resolveSource()`) before showing the include picker, so the picker reflects the exact tree the user will sync against. First-ever init pays a one-time clone; subsequent inits against the same SHA hit the cache. Network failure falls back to free-text include input.
- `list` is manifest-aware: defaults to the lockfile-pinned SHA, falls back to manifest `ref` (HEAD) with a warning, errors if no manifest and no `--home`.
- `validate` requires a lockfile-pinned SHA for include-resolution; `--no-resolve` opts out for pre-sync structural-only validation. No more `resolveHomeRoot()` fallback.
- `sync <project> --home <local-tree>` preserves any prior `source` block in the lockfile rather than dropping or overwriting it. Projects that have only ever sync'd with `--home` legitimately produce a lockfile with no `source` block.
- The architectural shift to GitHub-only source is documented across ADRs 0011–0015 (planned).
- Missing `source` fails during manifest schema parse after reading the manifest file, before any sync pipeline I/O.
- `GLOBAL_RESERVED_MESSAGE` applies only when `scope !== home`.
- `sync --global` fails fast if the home manifest `scope` is not `home`.
- Home manifest, lockfile, and targets are always derived from `resolveHomePaths()` (including overrides).
- `init` and `init --global` should interactively prompt for `source.repo` and `source.ref` (repo as `owner/name` only).
- Non-interactive `init` requires explicit repo/ref flags; no placeholders.
- Add `init` flags `--repo` and `--ref` for non-interactive usage.
- `--repo`/`--ref` apply only to `init`, not `sync`.
- `init` validates repo format (`owner/name`) and shows a friendly error on mismatch.
- The CLI and source asset catalog live in the same repository.
- The source layout is domain-first.
- The `global` domain is reserved for universal workflow assets and is only allowed in `scope: home` manifests.
- Manifests are explicit and have no defaults.
- Profiles are allowed, but nested profiles are rejected in version 1.
- Directory includes are bundles and expand to supported artifacts.
- Generated and vendored modes are separate ownership models.
- Generated files may be overwritten only when they carry the generated marker.
- Vendored files may be updated only when the lockfile proves the target file has not been locally edited.
- Target paths are flattened for harness compatibility.
- Collisions fail validation. Version 1 does not support aliases.
- Adapters append target-specific notes after neutral source content.
- Project-local `./` includes resolve from `<project>/.agent-library`.
- `sync`, `validate`, and `list` are non-interactive.
- `init` is interactive by default.
- Bun is the development runtime, test runner, package manager, and executable compiler.
- Use Bun-native APIs throughout: `Bun.file()` for file I/O, `Bun.spawnSync()` / `Bun.spawn()` for subprocess execution, `bun:sqlite` for SQLite, `bun:test` for tests. Do **not** use Node.js equivalents (`node:fs`, `node:child_process`, etc.) even though they are available under Bun. Exceptions: `node:fs` synchronous directory APIs (`readdirSync`, `statSync`, `existsSync`) and `node:fs/promises.rename` are acceptable where Bun has no native equivalent (synchronous directory walking and atomic file rename).
- TypeScript, Commander, Zod, `yaml`, `@clack/prompts`, Chalk, and Bun-native `crypto` form the implementation stack.
- All error handling must follow the Result pattern via `ResultKit` (`src/util/result-kit/`). Functions that can fail return `Result<T, E>` instead of throwing. Callers unwrap with `result.ok` guards. Error types are discriminated unions using `TypedError<T>` / `TypedErrorUnion<T>`. Do **not** use `throw` or `try/catch` for domain errors; reserve exceptions only for programmer errors (bugs) that should crash the process immediately.

## Implementation Shape

The CLI should stay testable by following a pure planning pipeline:

```text
loadManifest -> validate -> resolveIncludes -> expandBundles -> planArtifacts -> detectCollisions -> write -> updateLockfile
```

In the current implementation `expandBundles` is embedded inside `resolveIncludes` (`src/resolve/sources.ts` calls `expandBundle` internally). Lockfile support is implemented in `src/lockfile/`; current lockfiles use schema version 1.

Lockfile target adapter state is discriminated: `{ kind: "none" }` when no adapter was applied, or `{ kind: "applied", source, hash }` when a target-specific adapter contributed content.

Mode-specific behavior belongs after planning. Generated and vendored sync should share resolution, planning, adapter merging, and hashing behavior where possible.

The implementation plan deliberately builds the CLI in slices:

1. Bootstrap the CLI.
2. Validate manifest structure.
3. Resolve sources and list catalog entries.
4. Sync generated skills.
5. Add commands, agents, dual targets, and collision checks.
6. Add adapters.
7. Add lockfile and generated stale cleanup.
8. Add vendored mode.
9. Add project-local includes and bundle expansion in lockfiles.
10. Add `init`, `--dry-run`, and summary polish.

## Risks and Tensions

The plan and standard mostly align, but implementers should resolve these details during execution:

- The standard says bundled commands under a skill install with the skill. The plan also says bundled files inside a skill folder are copied verbatim. Implementation should decide whether bundled command markdown maps to target `commands/` or remains under the skill folder, then test that behavior.
- Task 9 adds project-local paths and lockfile bundle expansion after lockfile and vendored work. It may touch the same planning and lockfile code as Tasks 7 and 8, so it should be sequenced carefully.
- The plan names Task 8 in the initial risk list for project paths, but the detailed task is Task 9. Treat the detailed task numbering as authoritative.
- The standard allows both `commands/` and legacy `command/`; the plan primarily references `commands/`. Compatibility should be explicit in discovery tests.
- The spec says generated cleanup may remove recognizable generated files, while the plan prefers lockfile-driven cleanup. The safer version is lockfile-driven cleanup plus marker checks.
- Vendored conflicts are warnings with exit code 0 in the plan. If teams need CI enforcement later, add an explicit strict mode instead of changing default behavior.

## Out of Scope

- Migrating existing `.agents` or `.claude` content.
- Nested profile support.
- Alias support for collisions.
- Automatic `.gitignore` edits.
- JSON output mode for `list`.
- Cross-platform binary publishing beyond the current platform executable.
- Bare-repo cache pruning — `cache prune` currently removes only extracted trees. Bare repos under `~/.cache/agent-library/repos/` are never cleaned up. A future `cache prune --repos` command should scan the registry for referenced repos, compare against the `repos/` directory, and remove unreferenced bare clones.

## Related ADRs

- [ADR 0001: Canonical Repository And Target Directories](docs/adr/0001-canonical-repository-and-target-directories.md)
- [ADR 0002: Domain-First Source Layout](docs/adr/0002-domain-first-source-layout.md)
- [ADR 0003: Explicit YAML Manifests](docs/adr/0003-explicit-yaml-manifests.md)
- [ADR 0004: Generated And Vendored Modes](docs/adr/0004-generated-and-vendored-modes.md)
- [ADR 0005: Additive Target Adapters](docs/adr/0005-additive-target-adapters.md)
- [ADR 0006: Flattened Target Paths And Collision Failure](docs/adr/0006-flattened-target-paths-and-collision-failure.md)
- [ADR 0007: Lockfile Hash Ownership Model](docs/adr/0007-lockfile-hash-ownership-model.md)
- [ADR 0008: Bun TypeScript CLI Stack](docs/adr/0008-bun-typescript-cli-stack.md)
- [ADR 0009: Project-Local Source Includes](docs/adr/0009-project-local-source-includes.md)
- [ADR 0010: CLI Command Interaction Model](docs/adr/0010-cli-command-interaction-model.md)
- [ADR 0011: GitHub-Only Source](docs/adr/0011-github-only-source.md)
- [ADR 0012: `--home` Flag Subcommand Overload](docs/adr/0012-home-flag-subcommand-overload.md)
- [ADR 0013: `init` On-Demand Source Materialisation](docs/adr/0013-init-on-demand-source-materialisation.md)
- [ADR 0014: `list` and `validate` Manifest-Aware](docs/adr/0014-list-and-validate-manifest-aware.md)
- [ADR 0015: Lockfile Source Preserved Under `--home`](docs/adr/0015-lockfile-source-preserved-under-home.md)
