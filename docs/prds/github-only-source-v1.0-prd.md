# GitHub-Only Source — Product Requirements Document (PRD)

## Requirements Description

### Background

- **Business Problem**: The CLI currently falls back to a local `~/.agent-library` directory when no `source:` block is present in the manifest. This creates two competing source models (local disk vs. GitHub), complicates reasoning about asset provenance, and allows assets to drift silently when the local copy is out of date. Removing the local fallback makes GitHub the single canonical source for all assets.
- **Target Users**: CLI users who manage agent skills, commands, and agents across one or more projects and at the global (home) level.
- **Value Proposition**: Every sync is reproducible from a declared GitHub ref. Users know exactly what commit their assets came from, at both the global and project level.

### Feature Overview

- **Core Features**:
  1. Make `source:` required in the manifest schema — validation rejects any manifest that omits it.
  2. Add a `--global` flag to `sync` that resolves the home-level manifest and writes artifacts to the user's home directories.
  3. Add a `--global` flag to `init` that creates the home manifest at the platform-correct path with `scope: home` pre-set.
  4. Remove the local-library fallback from `sync` — the `else` branch that calls `resolveHomeRoot` without a source disappears.
  5. Tighten the `global` domain restriction: `global` assets are only allowed in `scope: "home"` manifests, regardless of whether a `source:` block is present (previously, having any `source:` was an implicit exemption).
  6. Platform-aware home path resolution for manifest and artifact targets.

- **Feature Boundaries**:
  - `--home` flag and `HOME_AGENT_LIBRARY` env var are kept unchanged as dev/testing escape hatches.
  - No migration tooling for existing users with a local `~/.agent-library` directory — out of scope.
  - The local fallback code is removed, not deprecated behind a flag.

- **User Scenarios**:
  - *Global install*: `agent-lib init --global` → creates `~/.agent-library.yml` with `scope: home` and a `source:` stub → user fills in repo/ref → runs `agent-lib sync --global` → global skills appear in `~/.claude/` and `~/.agents/`.
  - *Project install*: unchanged UX — `agent-lib init` → `agent-lib sync <project-root>`.
  - *CI/offline*: lockfile pins SHA; `sync` without `--update` uses cached tree; fails with a clear message if the bare repo isn't cached.

### Detailed Requirements

- **Manifest schema change**: `source` field moves from `ManifestSourceSchema.optional()` to `ManifestSourceSchema` (required). Zod parse error message must be user-readable: `"source is required; add a source block with type, repo, and ref"`.
- **Home manifest location**:
  - Windows: `%USERPROFILE%\.agent-library.yml`
  - Linux / macOS: `~/.agent-library.yml`
- **Home artifact targets**:
  - Windows: `%USERPROFILE%\.claude\` and `%USERPROFILE%\.agents\`
  - Linux / macOS: `~/.claude/` and `~/.agents/`
- **Home lockfile location** (inferred, same pattern): `%USERPROFILE%\.agent-library.lock` / `~/.agent-library.lock`
- **`init --global`**: creates the home manifest with `scope: home` pre-set; must not overwrite an existing file without prompting.
- **`sync --global`**: resolves the home manifest path, runs the full pipeline (`loadManifest → validate → resolveIncludes → … → writeLockfile`), and writes artifacts to the home target dirs.
- **Global domain restriction**: `validateManifest` and `validateResolvedArtifactsScope` must reject `global` domain includes in any manifest where `scope !== "home"` — the previous `|| manifest.source` exemption is removed.
- **Error messages**:
  - Missing `source:` block → `error: source is required; add a source block with type, repo, and ref`
  - `global` domain in a project manifest → existing `GLOBAL_RESERVED_MESSAGE` (no change to wording)
  - `sync --global` when home manifest does not exist → `error: no home manifest found at <path>; run \`agent-lib init --global\` to create one`

---

## Design Decisions

### Technical Approach

- **Architecture Choice**: Minimal surgical changes — no new abstractions. The sync pipeline is unchanged; only the entry-point logic (source resolution + target root selection) and schema change are affected.
- **Key Components**:
  - `src/manifest/schema.ts` — `source` required
  - `src/manifest/validate.ts` — tighten global domain guard (remove `|| manifest.source`)
  - `src/util/home.ts` — add `resolveHomePaths(): { manifest, lockfile, claude, agents }` that returns platform-correct absolute paths
  - `src/commands/sync.ts` — add `--global` flag; remove the `else` fallback branch
  - `src/commands/init.ts` — add `--global` flag; write home manifest with `scope: home`
- **Data Storage**: No new storage model. Home scope reuses the same lockfile schema; lockfile lives next to the home manifest.
- **Interface Design**: CLI flags only — no config file changes.

### Constraints

- **Performance**: No impact — source resolution path is unchanged.
- **Compatibility**: `--home` and `HOME_AGENT_LIBRARY` are preserved. Any existing project manifests that already have a `source:` block continue to work without changes.
- **Security**: No new network paths. The GitHub fetch path is unchanged.
- **Scalability**: Home scope shares the same bare-repo cache under `~/.cache/agent-library/` as project scope.

### Risk Assessment

- **Breakage for existing users without `source:`**: The schema change is a breaking change. Any manifest currently relying on the local fallback will now fail validation. Mitigation: clear error message pointing to the fix.
- **Windows path handling**: `%USERPROFILE%` vs `~` divergence must be covered by tests on both platforms. Risk: Windows CI may not be wired up. Mitigation: unit-test `resolveHomePaths()` with a mocked `process.platform` and `process.env.USERPROFILE`.
- **`init --global` overwrite guard**: If the home manifest already exists and `init --global` overwrites silently, users lose their config. Mitigation: check existence before writing; prompt or error.

---

## Acceptance Criteria

### Functional Acceptance

- [ ] A manifest without `source:` fails `validateManifest` with a clear error message before any file I/O.
- [ ] `agent-lib init --global` creates `~/.agent-library.yml` (Linux/macOS) or `%USERPROFILE%\.agent-library.yml` (Windows) with `scope: home` set and does not overwrite an existing file without confirmation.
- [ ] `agent-lib sync --global` reads the home manifest, resolves GitHub source, and writes artifacts to `~/.claude/` + `~/.agents/` (Linux/macOS) or the `%USERPROFILE%` equivalents (Windows).
- [ ] `agent-lib sync --global` when the home manifest is absent exits with a non-zero code and a helpful error message.
- [ ] A project-scope manifest (`scope: project`) that includes a `global/` entry fails validation with `GLOBAL_RESERVED_MESSAGE`.
- [ ] `agent-lib sync <project-root>` with a manifest that has a valid `source:` block continues to work exactly as before.
- [ ] `--home` flag still overrides `homeRoot` for dev/testing and bypasses source resolution.

### Quality Standards

- [ ] Code Quality: no new `throw`/`try-catch` for domain errors — Result pattern throughout.
- [ ] Test Coverage: unit tests for `resolveHomePaths()` covering Windows and Linux branches; integration tests for `init --global` and `sync --global`.
- [ ] No Node.js APIs introduced — `Bun.file`, `node:fs` sync APIs only where already established.

### User Acceptance

- [ ] Running `sync` on a manifest missing `source:` produces a single, actionable error line (no stack trace).
- [ ] `init --global` followed by `sync --global` completes without errors on a fresh machine (given network access).

---

## Execution Phases

### Phase 1 — Schema & Validation Tightening
**Goal**: Make `source:` required at parse time; close the global-domain loophole.

- [ ] `src/manifest/schema.ts`: remove `.optional()` from `source`; add human-readable Zod error message.
- [ ] `src/manifest/validate.ts`: remove `|| manifest.source` from both `validateManifest` and `validateResolvedArtifactsScope`.
- [ ] Update unit tests in `tests/unit/manifest.test.ts` for the new required `source:` behavior.
- **Deliverables**: Failing tests for manifests without `source:`; passing tests for the tightened global domain check.
- **Estimated effort**: 0.5 day

### Phase 2 — Platform-Aware Home Paths
**Goal**: Single function that returns correct paths for the home manifest, lockfile, and target dirs on all platforms.

- [ ] `src/util/home.ts`: add `resolveHomePaths(platform?, env?)` returning `{ manifest, lockfile, claude, agents }`.
- [ ] Unit tests with mocked `process.platform` and env vars for Windows and Linux/macOS branches.
- **Deliverables**: `resolveHomePaths` with full test coverage.
- **Estimated effort**: 0.5 day

### Phase 3 — `sync --global` Command
**Goal**: Wire the `--global` flag into the existing sync pipeline.

- [ ] `src/commands/sync.ts`: add `--global` option; when set, resolve `projectRoot` and `homeRoot` from `resolveHomePaths()`; error if home manifest absent.
- [ ] Remove the `else` branch that calls `resolveHomeRoot(opts.home)` without a source (replace with error or `--home` path only).
- [ ] Integration test: `sync --global` with a fixture home manifest pointing at a local bare repo.
- **Deliverables**: `sync --global` passing integration tests; no regressions on `sync <project-root>`.
- **Estimated effort**: 1 day

### Phase 4 — `init --global` Command
**Goal**: Allow users to bootstrap the home manifest interactively.

- [ ] `src/commands/init.ts`: add `--global` flag; write home manifest at platform-correct path with `scope: home`; guard against overwrite.
- [ ] Integration test: `init --global` on a clean env produces a valid, parseable manifest.
- **Deliverables**: `init --global` passing tests; `init` without `--global` unchanged.
- **Estimated effort**: 0.5 day

### Phase 5 — Documentation & CONTEXT Update
**Goal**: Keep the narrative document aligned with the new decisions.

- [ ] Update `CONTEXT.md`: replace "canonical library path is `~/.agent-library`" with the GitHub-only source model and the two-scope setup.
- [ ] Add ADR for the GitHub-only source decision.
- **Deliverables**: Updated `CONTEXT.md`; new ADR file.
- **Estimated effort**: 0.5 day

---

**Document Version**: 1.0
**Created**: 2026-05-15
**Clarification Rounds**: 3
**Quality Score**: 91/100
