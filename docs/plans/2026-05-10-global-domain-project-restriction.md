# Global Domain Project Restriction Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Use the repo's available execution skill when one exists (for example, subagent-driven-development or executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent project manifests from selecting or syncing the reserved `global` domain, while allowing home manifests to opt in explicitly with `scope: home`.

**Architecture:** Add `scope` to the manifest schema with a project default, then centralize the reserved-domain policy in manifest validation helpers used by `validate`, `sync`, and `init`. `init --global` switches the generated manifest to home scope and keeps global entries available; normal project init filters direct global choices and profiles that resolve to global artifacts.

**Tech Stack:** Bun runtime and test runner, TypeScript, Commander, Zod, YAML, Clack prompts, existing ResultKit error style.

**Assumptions:**
- A `global` reference means `global` or any path beginning with `global/`.
- Project scope also rejects profiles that resolve to global artifacts. This is required because `tests/fixtures/home-min/profiles/universal.yml` expands to `global`, and allowing it would preserve the bug described in the spec.
- Existing integration fixtures that intentionally exercise global artifact syncing should become home-scoped fixtures by adding `scope: home`; path inference is deliberately not used.
- Normal project init should omit `scope` from the written YAML. `ManifestSchema.parse` supplies `scope: "project"` internally.

---

## Scope Check

This is one vertical slice across schema, validation, sync, and init. It does not add migration, aliases, source model work, or GitHub source-of-truth behavior.

## File Structure

- Modify `src/manifest/schema.ts`: add manifest `scope` default.
- Modify `src/manifest/validate.ts`: add the reserved-global policy helpers and issue formatting.
- Modify `src/commands/validate.ts`: use issue formatting and validate resolved global artifacts.
- Modify `src/commands/sync.ts`: use issue formatting and stop before planning when project scope resolves global artifacts.
- Modify `src/commands/init.ts`: add `--global`, generate `scope: home` only for home init, reject project init inputs that reference global, and filter the include UI.
- Modify tests:
  - `tests/unit/manifest.test.ts`
  - `tests/integration/validate.test.ts`
  - `tests/integration/sync-global-scope.test.ts`
  - `tests/integration/init.test.ts`
  - `tests/integration/dry-run.test.ts`
  - `tests/integration/sync-stale-cleanup.test.ts`
- Create fixtures:
  - `tests/fixtures/projects/validate-project-global/.agent-library.yml`
  - `tests/fixtures/projects/validate-project-global-profile/.agent-library.yml`
  - `tests/fixtures/projects/validate-home-global/.agent-library.yml`
- Modify existing global-sync fixtures to add `scope: home`:
  - `tests/fixtures/manifests/valid.yml`
  - `tests/fixtures/projects/p2-mixed/.agent-library.yml`
  - `tests/fixtures/projects/p4-adapters/.agent-library.yml`
  - `tests/fixtures/projects/p6-local/.agent-library.yml`
  - `tests/fixtures/projects/p7-bundle/.agent-library.yml`
  - `tests/fixtures/projects/validate-valid/.agent-library.yml`

## Acceptance Signal

Run from repo root:

```bash
bun run build
bun test
bun run typecheck
```

Expected: all commands exit 0. New negative paths must print:

```text
error: "global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.
```

---

### Task 1: Manifest Scope Schema and Direct Global Policy

**Files:**
- Modify: `src/manifest/schema.ts`
- Modify: `src/manifest/validate.ts`
- Test: `tests/unit/manifest.test.ts`
- Modify fixture: `tests/fixtures/manifests/valid.yml`

- [ ] **Step 1: Write the failing manifest validation tests**

Add these cases inside `describe("validateManifest", ...)` in `tests/unit/manifest.test.ts`:

```ts
  it("defaults missing scope to project when parsing manifest input", () => {
    const parsed = ManifestSchema.safeParse({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["frontend/skills/react-useeffect"],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.scope).toBe("project");
  });

  it("accepts a home-scoped valid manifest fixture", async () => {
    const result = await loadManifest("tests/fixtures/manifests/valid.yml");
    if (!result.ok)
      throw new Error(`Expected manifest to load: ${result.error.message}`);
    const parsed = ManifestSchema.safeParse(result.value);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.scope).toBe("home");
  });

  it("rejects direct global includes in project scope", () => {
    const issues = validateManifest({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["global"],
    });

    expect(issues).toEqual([
      {
        path: "",
        message:
          "\"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
      },
    ]);
  });

  it("rejects global artifact paths in project scope", () => {
    const issues = validateManifest({
      version: 1,
      mode: "generated",
      target: "both",
      include: ["global/skills/writing-plans"],
    });

    expect(issues[0].path).toBe("");
    expect(issues[0].message).toContain("\"global\" domain is reserved");
  });

  it("allows global includes in home scope", () => {
    const issues = validateManifest({
      version: 1,
      scope: "home",
      mode: "generated",
      target: "both",
      include: ["global", "global/skills/writing-plans"],
    });

    expect(issues).toEqual([]);
  });

  it("formats manifest-level issues as error lines", () => {
    expect(
      formatIssue({
        path: "",
        message:
          "\"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
      }),
    ).toBe(
      "error: \"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
    );
  });
```

Update the imports at the top of `tests/unit/manifest.test.ts`:

```ts
import { ManifestSchema } from "../../src/manifest/schema.ts";
import {
  formatIssue,
  validateManifest,
  validateSkillSpecs,
} from "../../src/manifest/validate.ts";
```

Change `tests/fixtures/manifests/valid.yml` to include `scope: home` because it intentionally includes a global artifact:

```yaml
version: 1
scope: home
mode: generated
target: both
include:
  - global/skills/writing-plans
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/unit/manifest.test.ts
```

Expected: FAIL with TypeScript/import errors for missing `ManifestSchema` import if not added, missing `formatIssue`, missing `scope`, or assertions showing project manifests still allow `global`.

- [ ] **Step 3: Add schema and policy helpers**

Update `src/manifest/schema.ts`:

```ts
export const ManifestSchema = z.object({
  version: z.literal(1, { error: "version is required and must be 1" }),
  scope: z.enum(["home", "project"]).default("project"),
  mode: z.enum(["generated", "vendored"]),
  target: z.enum(["codex", "claude", "both"]),
  include: z
    .array(z.string())
    .min(1, { error: "include must have at least one entry" }),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestInput = z.input<typeof ManifestSchema>;
```

Update `src/manifest/validate.ts`:

```ts
export const GLOBAL_RESERVED_MESSAGE =
  "\"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.";

export function formatIssue(issue: Issue): string {
  return issue.path.length > 0
    ? `${issue.path}: ${issue.message}`
    : `error: ${issue.message}`;
}

export function includeReferencesGlobal(entry: string): boolean {
  return entry === "global" || entry.startsWith("global/");
}
```

Then change `validateManifest` so it checks the parsed manifest after structural validation:

```ts
export function validateManifest(input: unknown): Issue[] {
  const r = ManifestSchema.safeParse(input);
  if (!r.success) {
    return r.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
  }

  if (
    r.data.scope !== "home" &&
    r.data.include.some((entry) => includeReferencesGlobal(entry))
  ) {
    return [{ path: "", message: GLOBAL_RESERVED_MESSAGE }];
  }

  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test tests/unit/manifest.test.ts
```

Expected: PASS for `validateManifest` and `validateSkillSpecs`.

- [ ] **Step 5: Run typecheck to catch schema output type fallout**

Run:

```bash
bun run typecheck
```

Expected: FAIL in files constructing `Manifest` without `scope`. Leave those failures for the later tasks that update init/test fixtures, except for any failure introduced directly inside `src/manifest/schema.ts` or `src/manifest/validate.ts`.

---

### Task 2: Validate and Sync Hard Errors Including Profile Expansion

**Depends on Task 1.**

**Files:**
- Modify: `src/manifest/validate.ts`
- Modify: `src/commands/validate.ts`
- Modify: `src/commands/sync.ts`
- Test: `tests/integration/validate.test.ts`
- Test: `tests/integration/sync-global-scope.test.ts`
- Create: `tests/fixtures/projects/validate-project-global/.agent-library.yml`
- Create: `tests/fixtures/projects/validate-project-global-profile/.agent-library.yml`
- Create: `tests/fixtures/projects/validate-home-global/.agent-library.yml`
- Modify fixture: `tests/fixtures/projects/validate-valid/.agent-library.yml`

- [ ] **Step 1: Write failing validate command tests**

Update `tests/integration/validate.test.ts` so `run` passes the fixture home root:

```ts
function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: {
      ...process.env,
      HOME_AGENT_LIBRARY: "tests/fixtures/home-min",
      NO_COLOR: "1",
    },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}
```

Add these tests inside `describe("validate command", ...)`:

```ts
  it("exits 1 for project manifests that include global directly", () => {
    const r = run(["validate", "tests/fixtures/projects/validate-project-global"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "error: \"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
    );
  });

  it("exits 1 for project manifests whose profile resolves global artifacts", () => {
    const r = run([
      "validate",
      "tests/fixtures/projects/validate-project-global-profile",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "error: \"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
    );
  });

  it("allows global includes for home-scoped manifests", () => {
    const r = run(["validate", "tests/fixtures/projects/validate-home-global"]);
    expect(r.code).toBe(0);
  });
```

Create `tests/fixtures/projects/validate-project-global/.agent-library.yml`:

```yaml
version: 1
mode: generated
target: both
include:
  - global
```

Create `tests/fixtures/projects/validate-project-global-profile/.agent-library.yml`:

```yaml
version: 1
mode: generated
target: both
include:
  - profile:universal
```

Create `tests/fixtures/projects/validate-home-global/.agent-library.yml`:

```yaml
version: 1
scope: home
mode: generated
target: both
include:
  - global
```

Update `tests/fixtures/projects/validate-valid/.agent-library.yml` to include `scope: home` because it still validates a global artifact include:

```yaml
version: 1
scope: home
mode: generated
target: both
include:
  - global/skills/writing-plans
```

- [ ] **Step 2: Write failing sync command tests**

Create `tests/integration/sync-global-scope.test.ts`:

```ts
import { describe, it, expect } from "bun:test";

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["./bin/agent-library", ...args], {
    env: {
      ...process.env,
      HOME_AGENT_LIBRARY: "tests/fixtures/home-min",
      NO_COLOR: "1",
    },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  };
}

describe("sync global scope restriction", () => {
  it("exits 1 before writing when a project manifest includes global directly", () => {
    const r = run(["sync", "tests/fixtures/projects/validate-project-global"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "error: \"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
    );
  });

  it("exits 1 before writing when a project profile resolves global artifacts", () => {
    const r = run([
      "sync",
      "tests/fixtures/projects/validate-project-global-profile",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "error: \"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
bun run build
bun test tests/integration/validate.test.ts
bun test tests/integration/sync-global-scope.test.ts
```

Expected: FAIL because `validate` only runs structural validation, and `sync` does not yet reject profile-expanded global artifacts or format manifest-level issues.

- [ ] **Step 4: Add resolved artifact scope validation**

In `src/manifest/validate.ts`, add:

```ts
export function validateResolvedArtifactsScope(
  manifest: Manifest,
  artifacts: Artifact[],
): Issue[] {
  if (manifest.scope === "home") return [];
  return artifacts.some((artifact) => artifact.domain === "global")
    ? [{ path: "", message: GLOBAL_RESERVED_MESSAGE }]
    : [];
}
```

The file already imports `type { Artifact }`, so only add `type { Manifest }` to the schema import:

```ts
import { ManifestSchema, type Manifest } from "./schema.ts";
```

- [ ] **Step 5: Wire `validate` to resolve includes and print formatted issues**

Update `src/commands/validate.ts` imports:

```ts
import { join, resolve } from "node:path";
import { loadManifest } from "../manifest/load.ts";
import {
  formatIssue,
  validateManifest,
  validateResolvedArtifactsScope,
} from "../manifest/validate.ts";
import { ManifestSchema } from "../manifest/schema.ts";
import { resolveHomeRoot } from "../util/home.ts";
import { resolveIncludes } from "../resolve/sources.ts";
```

After structural issues pass, parse and resolve:

```ts
    const manifest = ManifestSchema.parse(loaded.value);
    const absProjectRoot = resolve(projectRoot);
    const resolveResult = await resolveIncludes(manifest.include, {
      kind: "project",
      homeRoot: resolveHomeRoot(),
      projectRoot: absProjectRoot,
    });

    if (!resolveResult.ok) {
      process.stderr.write(`error: ${resolveResult.error.message}\n`);
      process.exit(1);
    }

    const resolvedScopeIssues = validateResolvedArtifactsScope(
      manifest,
      resolveResult.value,
    );

    if (resolvedScopeIssues.length > 0) {
      for (const issue of resolvedScopeIssues) {
        process.stderr.write(`${formatIssue(issue)}\n`);
      }
      process.exit(1);
    }
```

Change existing issue printing in `src/commands/validate.ts`:

```ts
    for (const issue of issues) {
      process.stderr.write(`${formatIssue(issue)}\n`);
    }
```

- [ ] **Step 6: Wire `sync` to stop after resolution when project scope resolves global**

Update `src/commands/sync.ts` imports:

```ts
import {
  formatIssue,
  validateManifest,
  validateResolvedArtifactsScope,
  validateSkillSpecs,
} from "../manifest/validate.ts";
```

Change structural issue printing:

```ts
        for (const issue of structuralIssues) {
          process.stderr.write(`${formatIssue(issue)}\n`);
        }
```

After `const artifacts = resolveResult.value;`, add:

```ts
      const resolvedScopeIssues = validateResolvedArtifactsScope(
        manifest,
        artifacts,
      );

      if (resolvedScopeIssues.length > 0) {
        for (const issue of resolvedScopeIssues) {
          process.stderr.write(`${formatIssue(issue)}\n`);
        }

        process.exit(1);
      }
```

- [ ] **Step 7: Run test to verify it passes**

Run:

```bash
bun run build
bun test tests/integration/validate.test.ts
bun test tests/integration/sync-global-scope.test.ts
```

Expected: PASS for `validate command`.

---

### Task 3: Project Init Rejects Global and Defaults to Project-Safe Includes

**Depends on Tasks 1-2.**

**Files:**
- Modify: `src/commands/init.ts`
- Test: `tests/integration/init.test.ts`

- [ ] **Step 1: Write failing project-init tests**

In `tests/integration/init.test.ts`, change the default manifest assertion in `creates a manifest from prompt defaults and refuses overwrite`:

```ts
    expect(parsed.success && parsed.data).toEqual({
      version: 1,
      scope: "project",
      mode: "generated",
      target: "both",
      include: ["frontend"],
    });
    expect(manifest.scope).toBeUndefined();
```

Replace the existing explicit global success tests with project rejection tests:

```ts
  it("rejects an explicit global include without --global", async () => {
    const r = await run(
      ["init", TEMP_PROJECT],
      "\n\nglobal/skills/writing-plans\n",
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "\"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
    );
  });

  it("rejects multiple explicit global include entries without --global", async () => {
    const r = await run(
      ["init", TEMP_PROJECT],
      "\n\nglobal/skills/writing-plans,global/commands/review-pr\n",
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "\"global\" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.",
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun run build
bun test tests/integration/init.test.ts
```

Expected: FAIL because project init still defaults to `profile:universal` and accepts explicit global includes.

- [ ] **Step 3: Add scope-aware init defaults**

Update the imports in `src/commands/init.ts`:

```ts
import type { Manifest, ManifestInput } from "../manifest/schema.ts";
import {
  GLOBAL_RESERVED_MESSAGE,
  includeReferencesGlobal,
  validateResolvedArtifactsScope,
} from "../manifest/validate.ts";
```

Add an init scope type:

```ts
type InitScope = Manifest["scope"];
```

Change `manifestFromStdinDefaults` to accept scope:

```ts
async function manifestFromStdinDefaults(
  homeRoot: string,
  projectRoot: string,
  scope: InitScope,
): Promise<Result<ManifestInput, InitError>> {
```

Use a scope-aware default include:

```ts
  const includeInput = valueOrDefault(
    lines[2],
    scope === "home" ? "profile:universal" : await defaultProjectInclude(homeRoot),
  );
```

Add this helper near `defaultIncludeSelection`:

```ts
async function defaultProjectInclude(homeRoot: string): Promise<string> {
  return discoverDomains(homeRoot).find((domain) => domain !== "global") ?? "";
}
```

After parsing includes in `manifestFromStdinDefaults`, reject project global references before resolving:

```ts
  if (scope !== "home" && include.some((entry) => includeReferencesGlobal(entry))) {
    return ResultKit.failure({
      type: "init_invalid_include" as const,
      message: GLOBAL_RESERVED_MESSAGE,
    });
  }
```

After the existing `resolveIncludes(include, ...)` block succeeds in `manifestFromStdinDefaults`, reject profile-expanded global artifacts:

```ts
  const scopeIssues = validateResolvedArtifactsScope(
    {
      version: 1,
      scope,
      mode,
      target,
      include,
    },
    resolved.value,
  );
  if (scopeIssues.length > 0) {
    return ResultKit.failure({
      type: "init_invalid_include" as const,
      message: scopeIssues[0].message,
    });
  }
```

Return a manifest that only writes `scope` for home init:

```ts
  return ResultKit.success({
    version: 1,
    ...(scope === "home" ? { scope } : {}),
    mode,
    target,
    include,
  });
```

Change `writeManifest` to accept `ManifestInput`:

```ts
function writeManifest(
  manifestPath: string,
  manifest: ManifestInput,
): Promise<Result<number, InitError>> {
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun run build
bun test tests/integration/init.test.ts
```

Expected: PASS for project init tests that do not use `--global`; `--global` and include-group tests are added in Task 4.

---

### Task 4: Home Init Flag and Include UI Filtering

**Depends on Task 3.**

**Files:**
- Modify: `src/commands/init.ts`
- Test: `tests/integration/init.test.ts`

- [ ] **Step 1: Write failing `--global` and group-filter tests**

In `tests/integration/init.test.ts`, add `buildIncludeGroups` to imports:

```ts
import { buildIncludeGroups } from "../../src/commands/init.ts";
```

Add these tests:

```ts
  it("creates a home-scoped manifest with --global", async () => {
    const r = await run(
      ["init", "--global", TEMP_PROJECT],
      "\n\nglobal/skills/writing-plans\n",
    );
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest).toEqual({
      version: 1,
      scope: "home",
      mode: "generated",
      target: "both",
      include: ["global/skills/writing-plans"],
    });
  });

  it("keeps the home default include when --global is set", async () => {
    const r = await run(["init", "--global", TEMP_PROJECT], "\n\n\n");
    expect(r.code).toBe(0);
    const manifest = parse(
      await Bun.file(join(TEMP_PROJECT, ".agent-library.yml")).text(),
    );
    expect(manifest.scope).toBe("home");
    expect(manifest.include).toEqual(["profile:universal"]);
  });

  it("filters global domain and global profiles from project include groups", async () => {
    const groups = await buildIncludeGroups(HOME, { allowGlobal: false });

    expect(groups.global).toBeUndefined();
    expect(groups.Profiles?.map((option) => option.value) ?? []).not.toContain(
      "profile:universal",
    );
    expect(groups.frontend?.some((option) => option.value === "frontend")).toBe(
      true,
    );
  });

  it("keeps global domain and profiles in home include groups", async () => {
    const groups = await buildIncludeGroups(HOME, { allowGlobal: true });

    expect(groups.global?.some((option) => option.value === "global")).toBe(true);
    expect(groups.Profiles?.map((option) => option.value)).toContain(
      "profile:universal",
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun run build
bun test tests/integration/init.test.ts
```

Expected: FAIL because `init` has no `--global` option and `buildIncludeGroups` is not exported or scope-aware.

- [ ] **Step 3: Add `--global` to the command action**

Change the command builder in `src/commands/init.ts`:

```ts
export const initCommand = new Command("init")
  .description("Create a .agent-library.yml manifest")
  .argument("[path]", "path where .agent-library.yml should be created", ".")
  .option("--global", "create a home-scoped manifest that may include global")
  .action(async (projectRoot: string, opts: { global?: boolean }) => {
```

At the start of the action, derive the scope:

```ts
    const scope: InitScope = opts.global === true ? "home" : "project";
```

Pass scope to stdin defaults:

```ts
      const manifestResult = await manifestFromStdinDefaults(
        homeRoot,
        absProjectRoot,
        scope,
      );
```

Pass scope to prompt include:

```ts
    const include = await promptInclude(homeRoot, absProjectRoot, scope);
```

Write `scope` only for home prompt manifests:

```ts
    const manifest: ManifestInput = {
      version: 1,
      ...(scope === "home" ? { scope } : {}),
      mode: mode.value,
      target: target.value,
      include: include.value,
    };
```

- [ ] **Step 4: Make include group construction scope-aware**

Change `promptInclude` signature:

```ts
async function promptInclude(
  homeRoot: string,
  projectRoot: string,
  scope: InitScope,
): Promise<Result<string[], InitError>> {
  const groups = await buildIncludeGroups(homeRoot, { allowGlobal: scope === "home" });
```

Reject project global references after combining selected and custom entries:

```ts
  if (scope !== "home" && all.some((entry) => includeReferencesGlobal(entry))) {
    return ResultKit.failure({
      type: "init_invalid_include" as const,
      message: GLOBAL_RESERVED_MESSAGE,
    });
  }
```

After the existing `resolveIncludes(all, ...)` block succeeds in `promptInclude`, reject profile-expanded global artifacts:

```ts
  const scopeIssues = validateResolvedArtifactsScope(
    {
      version: 1,
      scope,
      mode: "generated",
      target: "both",
      include: all,
    },
    resolved.value,
  );
  if (scopeIssues.length > 0) {
    return ResultKit.failure({
      type: "init_invalid_include" as const,
      message: scopeIssues[0].message,
    });
  }
```

Export and update `buildIncludeGroups`:

```ts
export async function buildIncludeGroups(
  homeRoot: string,
  options: { allowGlobal: boolean } = { allowGlobal: true },
): Promise<Record<string, Array<{ value: string; label: string; hint?: string }>>> {
```

When adding profiles, skip profiles that fail to resolve or resolve any global artifact if `allowGlobal` is false:

```ts
async function profileAllowedForScope(
  homeRoot: string,
  profileName: string,
  allowGlobal: boolean,
): Promise<boolean> {
  if (allowGlobal) return true;
  const resolved = await resolveIncludes([`profile:${profileName}`], {
    kind: "home",
    homeRoot,
  });
  if (!resolved.ok) return false;
  return resolved.value.every((artifact) => artifact.domain !== "global");
}
```

Replace the current `groups["Profiles"] = profiles.map(...)` block with an explicit loop:

```ts
      const profileOptions: Array<{ value: string; label: string }> = [];
      for (const entry of profiles) {
        const name = entry.slice(0, -4);
        if (!(await profileAllowedForScope(homeRoot, name, options.allowGlobal))) {
          continue;
        }
        profileOptions.push({ value: `profile:${name}`, label: `profile:${name}` });
      }
      if (profileOptions.length > 0) {
        groups["Profiles"] = profileOptions;
      }
```

Skip the whole `global` domain when `allowGlobal` is false:

```ts
  for (const domain of discoverDomains(homeRoot)) {
    if (!options.allowGlobal && domain === "global") continue;
    // existing logic
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
bun run build
bun test tests/integration/init.test.ts
```

Expected: PASS for all `init command` tests.

---

### Task 5: Preserve Existing Global Sync Coverage with Explicit Home Scope

**Depends on Tasks 1-4.**

**Files:**
- Modify fixtures:
  - `tests/fixtures/projects/p2-mixed/.agent-library.yml`
  - `tests/fixtures/projects/p4-adapters/.agent-library.yml`
  - `tests/fixtures/projects/p6-local/.agent-library.yml`
  - `tests/fixtures/projects/p7-bundle/.agent-library.yml`
- Modify: `tests/integration/sync-stale-cleanup.test.ts`
- Modify: `tests/integration/dry-run.test.ts`
- Modify: `tests/unit/plan.test.ts`

- [ ] **Step 1: Update home-scoped global sync fixtures**

Add `scope: home` after `version: 1` in each fixture that intentionally includes global artifacts:

```yaml
version: 1
scope: home
mode: generated
target: both
include:
  - global/skills/writing-plans
  - global/commands/review-pr
  - global/agents/security-reviewer
```

Use each file's existing `mode`, `target`, and `include` values; only add the `scope: home` line.

- [ ] **Step 2: Update dynamically written stale-cleanup manifests**

In `tests/integration/sync-stale-cleanup.test.ts`, update `setManifestIncludes`:

```ts
function setManifestIncludes(includes: string[]) {
  const manifest = {
    version: 1,
    scope: "home",
    mode: "generated",
    target: "both",
    include: includes,
  };
```

- [ ] **Step 3: Update dynamically written dry-run manifests**

In `tests/integration/dry-run.test.ts`, update the manifest text written in `prints stale removals without deleting generated files`:

```ts
    await Bun.write(
      join(TEMP_PROJECT, ".agent-library.yml"),
      [
        "version: 1",
        "scope: home",
        "mode: generated",
        "target: both",
        "include:",
        "  - global/skills/writing-plans",
        "",
      ].join("\n"),
    );
```

- [ ] **Step 4: Update typed test manifests**

In `tests/unit/plan.test.ts`, add `scope: "home"` to the `Manifest` literal that includes `global`:

```ts
    const manifest: Manifest = {
      version: 1,
      scope: "home",
      mode: "generated",
      target: "both",
      include: ["global", "frontend/skills/react-useeffect"],
    };
```

- [ ] **Step 5: Run affected integration tests**

Run:

```bash
bun run build
bun test tests/integration/sync-mixed.test.ts
bun test tests/integration/sync-adapters.test.ts
bun test tests/integration/sync-project-local.test.ts
bun test tests/integration/sync-bundle-expansion.test.ts
bun test tests/integration/sync-stale-cleanup.test.ts
bun test tests/integration/dry-run.test.ts
bun test tests/integration/sync-lockfile.test.ts
```

Expected: PASS for all listed integration tests. Any failure with the reserved-global error means that fixture or dynamically written manifest still needs `scope: home`.

- [ ] **Step 6: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

---

### Task 6: End-to-End Regression and Cleanup

**Depends on Tasks 1-5.**

**Files:**
- Modify only files already touched by earlier tasks.

- [ ] **Step 1: Run the full suite**

Run:

```bash
bun run build
bun test
bun run typecheck
```

Expected: PASS for the full test suite and typecheck.

- [ ] **Step 2: Inspect changed files**

Run:

```bash
git diff -- src/manifest/schema.ts src/manifest/validate.ts src/commands/validate.ts src/commands/sync.ts src/commands/init.ts tests/unit/manifest.test.ts tests/integration/validate.test.ts tests/integration/sync-global-scope.test.ts tests/integration/init.test.ts tests/integration/dry-run.test.ts tests/integration/sync-stale-cleanup.test.ts tests/fixtures
```

Expected: diff contains only the scope field, reserved-global validation, `--global` init behavior, tests, and fixture scope annotations. No unrelated refactors.

- [ ] **Step 3: Verify the exact user-facing error**

Run:

```bash
bun run build
./bin/agent-library validate tests/fixtures/projects/validate-project-global
```

Expected: exit code 1 and stderr contains exactly:

```text
error: "global" domain is reserved for the home manifest. Remove it from include or re-run `init --global`.
```

- [ ] **Step 4: Commit if required by workflow**

The repository does not require per-task commits. If the implementer is asked to commit at the end, use:

```bash
git add src/manifest/schema.ts src/manifest/validate.ts src/commands/validate.ts src/commands/sync.ts src/commands/init.ts tests/unit/manifest.test.ts tests/integration/validate.test.ts tests/integration/sync-global-scope.test.ts tests/integration/init.test.ts tests/integration/dry-run.test.ts tests/integration/sync-stale-cleanup.test.ts tests/fixtures
git commit -m "feat: restrict global domain to home manifests"
```
