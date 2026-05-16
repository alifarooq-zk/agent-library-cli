# GitHub-Only Source Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Use the repo's available execution skill when one exists (for example, subagent-driven-development or executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require GitHub source blocks everywhere, add home-scope `--global` init/sync paths, and capture repo/ref during init while keeping tests green.

**Architecture:** Enforce `source` at schema level, tighten global-domain validation, add home-path resolution for manifests/targets, and wire `--global` into init/sync entry points. Preserve `--home` as a dev/testing path override (semantics depend on subcommand — see below). Update fixtures/tests to include source blocks and pass `--home` where local fixtures are used.

**Tech Stack:** Bun, TypeScript, Commander, Zod, yaml, bun:test

## `--home` flag semantics (resolved 2026-05-16)

A single `--home <path>` flag is preserved, but its meaning differs by subcommand. The two jobs are disjoint, so the overload is unambiguous in context.

| Subcommand | Job of `--home <path>` | Source fetch from GitHub? |
|---|---|---|
| `sync <project>` | Treat `<path>` as the **library tree** (a pre-materialised source checkout). Bypasses `resolveSource()`. | **No.** `source` is still required by schema; the lockfile's `source` block from any prior sync is preserved. |
| `sync --global` | Override the **home base** (the directory under which the home manifest, lockfile, `.claude`, and `.agents` live). | **Yes.** Source resolution still runs against the home manifest's `source` block. |
| `init <project>` | Treat `<path>` as the library tree; skip on-demand materialisation; populate the include picker from it. Manifest still records the user-supplied `source` block. | **No.** No fetch during init. |
| `init --global` | Override the **home base** where the new home manifest is written. On-demand materialisation for the picker still runs against the manifest's `source` block. | **Yes.** Same fetch flow as `sync --global`. |

`HOME_AGENT_LIBRARY` (env var) is honoured as a fallback for `--home` on `sync <project>` (library-tree job) only, preserving today's behaviour. It is **not** consulted for `--global` subcommands; those derive their home base via `resolveHomePaths()`.

Rationale: local-fixture tests need a way to skip the network entirely (library-tree job). `--global` tests need a way to redirect the home base without writing to the real `~/.claude` / `~/.agents`. One flag, two jobs — chosen over splitting because both jobs are dev/test affordances and the `--global` presence/absence already disambiguates them.

---

## File Structure Map

**Modify**
- `src/manifest/schema.ts`
- `src/manifest/validate.ts`
- `src/util/home.ts`
- `src/commands/init.ts`
- `src/commands/sync.ts`
- `src/commands/list.ts`
- `src/commands/validate.ts`
- `tests/unit/manifest-source.test.ts`
- `tests/unit/manifest.test.ts`
- `tests/integration/init.test.ts`
- `tests/integration/validate.test.ts`
- `tests/integration/sync-global-scope.test.ts`
- `tests/integration/sync-generated-skill.test.ts`
- `tests/integration/sync-*.test.ts` (local-fixture tests that run `sync` without `--home`)
- `tests/integration/list.test.ts`
- `tests/fixtures/manifests/*.yml`
- `tests/fixtures/projects/**/.agent-library.yml`

**Create**
- `tests/unit/home.test.ts`
- `docs/adr/0011-github-only-source.md`

---

### Task 1: Require `source` in schema + unit tests for missing source

**Files:**
- Modify: `tests/unit/manifest-source.test.ts`, `tests/unit/manifest.test.ts`
- Modify: `tests/fixtures/manifests/valid.yml`, `tests/fixtures/manifests/bad-mode.yml`, `tests/fixtures/manifests/bad-target.yml`, `tests/fixtures/manifests/empty-include.yml`
- Modify: `src/manifest/schema.ts`

- [ ] **Step 1: Write failing tests for missing source**

Update `tests/unit/manifest-source.test.ts`:
```ts
it("rejects a manifest without source", () => {
  const result = ManifestSchema.safeParse({
    version: 1,
    mode: "generated",
    target: "claude",
    include: ["global/skills/foo"],
  });
  expect(result.success).toBe(false);
});

it("rejects source.type other than github", () => {
  const result = ManifestSchema.safeParse({
    version: 1,
    mode: "generated",
    target: "claude",
    include: ["global/skills/foo"],
    source: { type: "local", repo: "org/repo", ref: "main" },
  });
  expect(result.success).toBe(false);
});
```

Update `tests/unit/manifest.test.ts` with a new case:
```ts
it("rejects missing source with a clear error message", () => {
  const issues = validateManifest({
    version: 1,
    mode: "generated",
    target: "both",
    include: ["frontend/skills/react-useeffect"],
  });
  expect(issues).toHaveLength(1);
  expect(issues[0].path).toBe("source");
  expect(issues[0].message).toBe(
    "source is required; add a source block with type, repo, and ref",
  );
});
```

- [ ] **Step 2: Run unit tests to confirm failure**

Run: `bun test tests/unit/manifest-source.test.ts tests/unit/manifest.test.ts`

Expected: FAIL with missing `source` acceptance and/or missing error message.

- [ ] **Step 3: Implement schema requirement + update manifest fixtures**

Update `src/manifest/schema.ts`:
- Remove `.optional()` from `source`.
- Add `required_error` message for `source` (use Zod’s `z.object` options or `z.preprocess` + `z.object` to surface the exact message).
- Ensure `repo` and `ref` remain required with explicit error messages.
- Keep `source.type` as `z.literal("github")` with a clear error message.

Update manifest fixtures to include a valid `source` block:
```yml
source:
  type: github
  repo: org/repo
  ref: main
```

- [ ] **Step 4: Run unit tests to confirm pass**

Run: `bun test tests/unit/manifest-source.test.ts tests/unit/manifest.test.ts`

Expected: PASS for both test files.

---

### Task 2: Tighten global-domain validation + update validation fixtures/tests

**Files:**
- Modify: `src/manifest/validate.ts`
- Modify: `tests/unit/manifest.test.ts`
- Modify: `tests/integration/validate.test.ts`, `tests/integration/sync-global-scope.test.ts`
- Modify: `tests/fixtures/projects/validate-*/.agent-library.yml`

- [ ] **Step 1: Update tests to remove source exemption**

In `tests/unit/manifest.test.ts`, remove the test that allows global includes when `source` is set and add a failing case that expects the global error even with `source` present:
```ts
it("rejects global includes in project scope even when source is set", () => {
  const issues = validateManifest({
    version: 1,
    mode: "generated",
    target: "both",
    include: ["global/skills/writing-plans"],
    source: { type: "github", repo: "org/repo", ref: "main" },
  });
  expect(issues[0].message).toContain('"global" domain is reserved');
});
```

- [ ] **Step 2: Run unit/integration tests to confirm failure**

Run: `bun test tests/unit/manifest.test.ts tests/integration/validate.test.ts tests/integration/sync-global-scope.test.ts`

Expected: FAIL due to validation still allowing global with `source`.

- [ ] **Step 3: Implement validation change + update fixtures**

Update `src/manifest/validate.ts`:
- Remove `manifest.source` exemptions in both `validateManifest` and `validateResolvedArtifactsScope`.

Update `tests/fixtures/projects/validate-*/.agent-library.yml` to include a valid `source` block so failures are about global scope (not missing source).

- [ ] **Step 4: Re-run tests**

Run: `bun test tests/unit/manifest.test.ts tests/integration/validate.test.ts tests/integration/sync-global-scope.test.ts`

Expected: PASS for the updated test set.

---

### Task 3: Add `resolveHomePaths()` with unit tests

**Files:**
- Create: `tests/unit/home.test.ts`
- Modify: `src/util/home.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/home.test.ts`:
```ts
import { describe, it, expect } from "bun:test";
import { resolveHomePaths } from "../../src/util/home.ts";

describe("resolveHomePaths", () => {
  it("uses USERPROFILE on win32", () => {
    const paths = resolveHomePaths("win32", { USERPROFILE: "C:\\Users\\A" });
    expect(paths.manifest).toBe("C:\\Users\\A\\.agent-library.yml");
    expect(paths.lockfile).toBe("C:\\Users\\A\\.agent-library.lock");
    expect(paths.claude).toBe("C:\\Users\\A\\.claude");
    expect(paths.agents).toBe("C:\\Users\\A\\.agents");
  });

  it("uses homedir on non-win32", () => {
    const paths = resolveHomePaths("linux", { HOME: "/home/al" });
    expect(paths.manifest).toBe("/home/al/.agent-library.yml");
  });

  it("respects override path", () => {
    const paths = resolveHomePaths("linux", { HOME: "/home/al" }, "/tmp/home");
    expect(paths.manifest).toBe("/tmp/home/.agent-library.yml");
  });
});
```

- [ ] **Step 2: Run unit test to confirm failure**

Run: `bun test tests/unit/home.test.ts`

Expected: FAIL (function missing).

- [ ] **Step 3: Implement `resolveHomePaths`**

Update `src/util/home.ts`:
- Add `resolveHomePaths(platform = process.platform, env = process.env, override?: string)`.
- Resolve base home directory:
  - If `override` provided, use it.
  - Else if `platform === "win32"`, use `env.USERPROFILE` (fallback to `homedir()` if missing).
  - Else use `env.HOME` (fallback to `homedir()` if missing).
- Return `{ manifest, lockfile, claude, agents }` with paths rooted at the base directory.
- Keep `resolveHomeRoot` unchanged for local-library root behavior.

- [ ] **Step 4: Run unit test to confirm pass**

Run: `bun test tests/unit/home.test.ts`

Expected: PASS.

---

### Task 4: Update `init` to capture repo/ref + add flags

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `tests/integration/init.test.ts`

- [ ] **Step 1: Write failing integration tests**

In `tests/integration/init.test.ts`, update existing cases and add new non-interactive error cases:
- All init runs must provide repo/ref (either prompt input or flags).
- Add a test that non-interactive `init` without `--repo/--ref` exits 1 with a clear error.
- Add a test that non-interactive `init --global` fails when the home manifest already exists (no prompt in non-interactive mode).

Example new test:
```ts
it("fails non-interactive init without --repo/--ref", async () => {
  const r = await run(["init", TEMP_PROJECT]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("--repo and --ref are required in non-interactive mode");
});
```

Update existing expected manifest snapshots to include:
```yml
source:
  type: github
  repo: org/repo
  ref: main
```

- [ ] **Step 2: Run integration test to confirm failure**

Run: `bun test tests/integration/init.test.ts`

Expected: FAIL (no repo/ref handling yet).

- [ ] **Step 3: Implement init repo/ref capture + on-demand source materialisation**

Update `src/commands/init.ts`:
- Add `--repo <owner/name>` and `--ref <ref>` options.
- Add prompt helpers `promptRepo()` and `promptRef()` using `text`.
- Add `validateRepoFormat()` (regex `^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$`).
- In non-interactive mode (`!process.stdin.isTTY`), require `opts.repo` and `opts.ref` and error if missing.
- Always write a `source` block (`{ type: "github", repo, ref }`).
- If `--global`, set `scope: "home"` in the manifest output.
- For `--global`, use `resolveHomePaths(..., opts.homeOverride?)` to derive `manifestPath` and ignore the positional path.
- If manifest exists and `process.stdin.isTTY` is true, prompt for overwrite using `confirm`; on cancel, exit with a clear message. If not TTY, fail immediately.
- Ensure overwrite guard respects the home manifest path.

**Reorder the interactive prompts so the source is captured and materialised _before_ the include picker runs.** New order:

1. Repo (prompt or `--repo`).
2. Ref (prompt or `--ref`).
3. Validate repo format. On failure, re-prompt (interactive) or exit (non-interactive).
4. **Resolve the library tree** (for the include picker):
   - **`init <project> --home <path>`**: skip the fetch entirely; use `<path>` as the `homeRoot` (library-tree job — symmetric with `sync <project> --home`).
   - **`init --global`**: do not treat `--home` as a library tree; it's the home-base override. Materialisation still runs.
   - **Otherwise**: call `resolveSource({ type: "github", repo, ref }, /* lockfilePath */ null, { update: false })` against an ephemeral lockfile context (no lockfile is written here; init's only goal is to populate the cache). Use the returned `homeRoot` for `buildIncludeGroups`.
5. Mode prompt.
6. Target prompt.
7. Include picker (`buildIncludeGroups(materialisedHomeRoot, { allowGlobal: scope === "home" })`).

**Offline-fallback path.** If step 4 fails with a network error (`fetchBareRepo` returns a `git_fetch_failed` or similar `GitCacheError`):
- Show a clear message: *"can't reach github.com; type include entries as free text, or re-run with network access for the picker."*
- Fall back to the existing free-text `text` input ([src/commands/init.ts:297](src/commands/init.ts#L297)) instead of `groupMultiselect`.
- Still write the manifest with the user-typed repo/ref; the next `sync` will retry source resolution.

- [ ] **Step 4: Re-run integration test**

Run: `bun test tests/integration/init.test.ts`

Expected: PASS. Tests must cover:
- First-ever init (no cache) clones the bare repo and shows the picker.
- Second init against the same SHA hits the cache and skips network (assert no clone occurred — mock or count git calls).
- Network failure during init falls back to free-text input and writes the manifest anyway.
- `init <project> --home <local-tree>` skips the fetch and uses the override; manifest still records `source`.
- `init --global --home <home-base>` writes the home manifest to `<home-base>` and still materialises from GitHub for the picker (home-base job, not library-tree job).

---

### Task 5: Add `sync --global` entry point + remove local fallback

**Files:**
- Modify: `src/commands/sync.ts`
- Modify: `tests/integration/sync-github-source.test.ts`
- Create/Modify: `tests/integration/sync-global.test.ts` (or add to existing suite)

- [ ] **Step 1: Write failing integration tests**

Add tests for `sync --global`:
- When home manifest missing, exits 1 with `error: no home manifest found at <path>; run \`agent-lib init --global\` to create one`.
- When home manifest `scope` is not `home`, exits 1 with clear error.

Also update any sync test that expects lockfile path to be `.agent-library.lock` to accept the home lockfile when `--global` is used.

- [ ] **Step 2: Run integration tests to confirm failure**

Run: `bun test tests/integration/sync-github-source.test.ts`

Expected: FAIL (no `--global` handling).

- [ ] **Step 3: Implement `--global` behavior**

Update `src/commands/sync.ts`:
- Add `.option("--global", ...)`.
- Change argument to optional: `.argument("[project-root]", ...)`.
- If `opts.global`:
  - Resolve `{ manifest, lockfile, claude, agents }` via `resolveHomePaths(platform?, env?, opts.home)` (home-base job).
  - Use `manifestPath = paths.manifest` and `lockfilePath = paths.lockfile`.
  - Set `projectRoot = dirname(paths.manifest)` so target dirs resolve into the home base.
  - Error if manifest missing or `manifest.scope !== "home"`.
  - Source fetch from GitHub still runs against the home manifest's `source` block; `--home` does **not** bypass it in `--global` mode.
- Else (non-global, `sync <project>`):
  - `source` is required by schema (no fallback).
  - If `opts.home` (or `HOME_AGENT_LIBRARY`) is set, treat it as the **library tree** (library-tree job): skip `resolveSource()`, use the directory as `homeRoot`. Schema still requires `source`.
  - **Lockfile source-block preservation under `--home`.** A `--home` sync does not produce a SHA, so it has no `LockfileSource` of its own to record. Instead:
    - Before building the new lockfile, read the existing `.agent-library.lock` (if any) and capture its `source` block.
    - When `plan.source` would otherwise be undefined (library-tree job), substitute the previously-recorded `source` block so it survives the round-trip.
    - If no prior lockfile exists, the new lockfile is written with no `source` block (which is schema-legal — `LockfileSource` is `.optional()`).
    - This preserves provenance from real GitHub syncs across dev-loop `--home` verifications.
  - Otherwise call `resolveSource()` to materialise the library tree from GitHub.

- [ ] **Step 4: Re-run sync integration tests**

Run: `bun test tests/integration/sync-github-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Add lockfile source-preservation round-trip test**

In `tests/integration/sync-github-source.test.ts` (or a new `sync-home-preserves-source.test.ts`):

```ts
it("preserves lockfile source block across a --home dev-loop sync", async () => {
  // 1. Real sync against (mocked) GitHub: writes lockfile with source.sha = X.
  // 2. Subsequent sync with --home <local-tree>: must not drop source.sha.
  // 3. Assert lockfile.source still equals { repo, sha: X, ref, fetchedAt }.
});

it("writes lockfile without source block on a --home sync with no prior lockfile", async () => {
  // Fresh project, only ever sync'd with --home.
  // Assert lockfile.source is absent (legal under the schema).
});
```

Expected: PASS.

---

### Task 6: Update local-fixture sync tests to pass `--home` + add `source` blocks

**Files:**
- Modify: `tests/fixtures/projects/p1-skill-only/.agent-library.yml` (and all `p2`–`p7`)
- Modify: `tests/integration/sync-*.test.ts` that run `sync <project>` with local fixtures
- Modify: any test that writes a manifest string inline (e.g., `sync-generated-skill.test.ts` bad-name case)

- [ ] **Step 1: Update fixtures with source blocks**

Add to every fixture manifest under `tests/fixtures/projects/**/.agent-library.yml`:
```yml
source:
  type: github
  repo: org/repo
  ref: main
```

- [ ] **Step 2: Update sync tests to pass `--home`**

For tests using local fixture libraries, update `run([...])` calls to include `--home` with the existing `HOME_AGENT_LIBRARY` path:
```ts
run(["sync", "--home", HOME, PROJECT]);
```

Update any inline manifest strings to include `source` as well.

- [ ] **Step 3: Run full sync-related integration tests**

Run: `bun test tests/integration/sync-generated-skill.test.ts tests/integration/sync-mixed.test.ts tests/integration/sync-vendored.test.ts`

Expected: PASS for the targeted suites (expand as needed if failures appear in other sync tests).

---

### Task 7: Update `list` and `validate` to be manifest-aware

`list` becomes manifest-driven (option 5a.i): reads the project manifest, materialises the pinned SHA, and lists the resulting tree. `validate` keeps doing structural validation but switches its include-resolution check from `resolveHomeRoot()` to the lockfile-pinned SHA (option 5b.iii).

**Files:**
- Modify: `src/commands/list.ts`
- Modify: `src/commands/validate.ts`
- Modify: `tests/integration/list.test.ts`
- Modify: `tests/integration/validate.test.ts`

- [ ] **Step 1: Update `list` tests**

In `tests/integration/list.test.ts`:
- Replace tests that rely on `resolveHomeRoot()` with tests that run `list` inside a project dir containing `.agent-library.yml` + `.agent-library.lock`. Assert that `list` reads the lockfile-pinned SHA, materialises from cache, and prints the catalogue.
- Add: `list --home <fixture-tree>` operates on the override directly without reading any manifest.
- Add: `list` outside a project dir (no manifest, no `--home`) exits 1 with *"no manifest in current directory; pass `--home <path>` or run from a project root"*.
- Add: `list` inside a project dir with a manifest but no lockfile yet runs `resolveSource()` against the manifest's `ref` (fetches HEAD) and prints the catalogue; warn that the result is not pinned.

- [ ] **Step 2: Implement `list` changes**

Update `src/commands/list.ts`:
- Remove the implicit `resolveHomeRoot()` default.
- New resolution order:
  1. If `--home <path>`: use directly (library-tree job).
  2. Else if `./.agent-library.yml` exists:
     - Load manifest.
     - If `.agent-library.lock` has a `source.sha`, materialise that SHA from cache (cache miss → error: *"locked SHA not in cache; run `sync --update`"*).
     - Else call `resolveSource()` against the manifest's `ref` to fetch HEAD; emit a warning that the result reflects HEAD, not a pinned SHA.
  3. Else exit 1 with the no-manifest error.
- Keep all subcommand variants (`list`, `list <domain>`, etc.) working against the resolved `homeRoot`.

- [ ] **Step 3: Update `validate` tests**

In `tests/integration/validate.test.ts`:
- Add: `validate` with manifest + lockfile (locked SHA in cache) validates structurally and resolves includes from the pinned tree. Offline path — no network.
- Add: `validate` with manifest but no lockfile exits 1 with *"no lockfile found; run `agent-library sync` first, or pass `--no-resolve` to skip include-resolution validation"*.
- Add: `validate --no-resolve` skips the include-resolution step and passes on manifest with no lockfile.
- Update existing fixtures to include `source` + lockfile where needed.

- [ ] **Step 4: Implement `validate` changes**

Update `src/commands/validate.ts`:
- Add `--no-resolve` option.
- Resolution order for the include-resolution step:
  1. If `--no-resolve`: skip include-resolution; only do structural validation.
  2. Else if `.agent-library.lock` with a `source.sha` exists in the project root: materialise from cache (cache miss → clear error).
  3. Else exit 1 with the "run sync first" error.
- Never fall back to `resolveHomeRoot()`.

- [ ] **Step 5: Re-run targeted tests**

Run: `bun test tests/integration/list.test.ts tests/integration/validate.test.ts`

Expected: PASS.

---

### Task 8: Add five ADRs for the architectural shift

This change produces five independently-surprising decisions. Each gets its own short ADR (two to five sentences) per [ADR-FORMAT.md](../../C:/Users/Ali Farooq/.claude/skills/grill-with-docs/ADR-FORMAT.md)'s "an ADR can be a single paragraph" guidance.

**Files:**
- Create: `docs/adr/0011-github-only-source.md`
- Create: `docs/adr/0012-home-flag-subcommand-overload.md`
- Create: `docs/adr/0013-init-on-demand-source-materialisation.md`
- Create: `docs/adr/0014-list-and-validate-manifest-aware.md`
- Create: `docs/adr/0015-lockfile-source-preserved-under-home.md`
- Modify: `docs/adr/README.md`
- Modify: `CONTEXT.md` (append the five new ADR entries under "Related ADRs")

- [ ] **Step 1: Write ADR 0011 — GitHub-only source**

Context: local `~/.agent-library/` fallback was canonical; provenance was implicit.
Decision: require a `source` block (GitHub repo + ref) in every manifest; remove the local fallback; canonical source is the GitHub repo at the resolved SHA.
Consequences: breaking change for manifests without source; reproducible syncs across machines; `~/.agent-library/` keeps a role as a library-author dev checkout but is never consulted by default.

- [ ] **Step 2: Write ADR 0012 — `--home` flag overloaded by subcommand**

Context: a single `--home` flag has two distinct dev/test jobs — pointing at a pre-materialised library tree (for `sync <project>` / `init <project>`) and overriding the home-base directory (for `sync --global` / `init --global`).
Decision: keep one flag, overloaded by subcommand. The `--global` presence/absence disambiguates the job. Considered splitting into `--library-root` and `--home-base`; rejected as more churn than the clarity gain warranted for a dev/test affordance.
Consequences: `HOME_AGENT_LIBRARY` env var is only honoured for the library-tree job. Subcommand docs must spell out which job applies.

- [ ] **Step 3: Write ADR 0013 — `init` materialises the source tree on demand**

Context: under GitHub-only source, a new user has no local tree, but the include picker is a first-class init UX surface and must show what's available.
Decision: after capturing repo/ref, `init` runs `resolveSource()` to materialise the tree, then drives the picker from the materialised result. First-ever init pays a one-time clone; subsequent inits against the same SHA hit cache. Network failure falls back to free-text input.
Consequences: init now requires network by default; offline init still works but loses the picker; cache grows over time (bare-repo pruning remains future work).

- [ ] **Step 4: Write ADR 0014 — `list` and `validate` are manifest-aware**

Context: both commands previously walked `resolveHomeRoot()`. Under GitHub-only, there is no implicit local tree.
Decision: `list` reads the project manifest, materialises the lockfile-pinned SHA (or manifest `ref` HEAD with a warning), and lists from there. `validate` requires the lockfile-pinned SHA for include-resolution; `--no-resolve` opts out for pre-sync structural-only validation.
Consequences: both commands work in project context. `validate` errors on a fresh project without a lockfile unless `--no-resolve` is passed. CI gates that ran `validate` pre-sync must add `--no-resolve` or run `sync` first.

- [ ] **Step 5: Write ADR 0015 — Lockfile source preserved under `--home`**

Context: `sync <project> --home <local-tree>` resolves no SHA, so it has no `LockfileSource` to record. Three options: drop the source block, preserve any prior block, or write a sentinel.
Decision: preserve any prior `source` block; do not overwrite under `--home`. A project that has only ever sync'd with `--home` legitimately produces a lockfile with no `source` block.
Consequences: dev-loop verifications don't damage provenance from real syncs. Lockfile is no longer monotonic with the most recent sync's source — it tracks the most recent *real* sync's source.

- [ ] **Step 6: Update ADR index**

Add five entries in `docs/adr/README.md` and in [CONTEXT.md](../../CONTEXT.md)'s "Related ADRs" list.

- [ ] **Step 7: (Optional) Quick doc check**

Run: `bun test tests/unit/manifest.test.ts`

Expected: PASS.

---

## Review Gate
- Run all touched tests until green.
- Ensure no new Node.js APIs were introduced beyond allowed sync `node:fs` usage.
