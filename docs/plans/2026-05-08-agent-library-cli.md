# Agent Library CLI Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Use the repo's available execution skill when one exists (for example, subagent-driven-development or executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a TypeScript CLI at `~/.agent-library` that resolves a manifest, generates or vendors agent assets into `.agents` and `.claude` targets, and tracks state in a lockfile — implementing the standard in `docs/specs/2026-05-08-agent-library-standard.md`.

**Architecture:** Single TypeScript package at the canonical library root. Entry point `src/cli.ts` uses **commander** to dispatch subcommands (`validate`, `list`, `sync`, `init`). A pure pipeline — `loadManifest → validate → resolveIncludes → expandBundles → planArtifacts → detectCollisions → write → updateLockfile` — keeps every command testable in isolation. Sync mode (`generated` vs `vendored`) is a strategy applied after the plan is built. The executable is compiled with Bun for the current platform and written to `bin/agent-library`.

**Tech Stack:** Bun, TypeScript 5, **commander** (CLI routing), **@clack/prompts** (interactive `init`), **zod** (all structured validation), **yaml** (manifest + lockfile), **chalk** (terminal colors), Node-compatible `crypto` (hashing), **bun test** (tests), **bun build --compile** (current-platform executable).

**Assumptions:**
- Greenfield: `~/.agent-library` is empty apart from `docs/specs/...` and this plan. Seed source assets are added only as test fixtures, not as production content.
- The CLI repo and the canonical asset library are the same directory (`~/.agent-library`). Tests use isolated fixture trees under `tests/fixtures/` so they never touch the real home library.
- `<name>.adapters/{claude,codex}.md` is the adapter convention for standalone subagent and command artifacts; skills continue to use a nested `adapters/` directory inside the skill folder.
- Markdown files (`*.md`) get the generated/vendored HTML-comment header. Non-markdown files (scripts, JSON, helpers) inside a skill bundle are copied verbatim and tracked in the lockfile only.
- `~/.agent-library` MUST be a Git repository per the spec; Bun manages dependencies and scripts at the repo root.
- Version 1 builds only the current platform executable. In this workspace, the target is `bun-linux-x64`.
- `sync`, `validate`, and `list` are non-interactive. `init` is interactive by default with `@clack/prompts`.
- No migration: the spec's "First Migration Strategy" is out of scope here.

**Risks:**
- Slice 7 (vendored update gating) and slice 8 (project `./` paths + bundle expansion) both extend the planning pipeline; if executed in parallel they may both touch `src/sync/plan.ts`. Run sequentially or coordinate.
- Bun standalone executable behavior should be smoke-tested early, because the binary is the v1 distribution path.

---

## File Structure

**New files (all under `/home/alifarooq/.agent-library/`):**

| File | Responsibility |
|------|----------------|
| `package.json` | Bun package, scripts, `bin: { "agent-library": "./bin/agent-library" }` |
| `tsconfig.json` | strict TS, ESM, Bun-friendly module resolution |
| `bin/agent-library` | Bun-compiled current-platform executable |
| `.gitignore` | `node_modules/`, compiled binary, fixture-generated targets |
| `src/cli.ts` | commander root, dispatches subcommands |
| `src/commands/validate.ts` | `validate <path>` subcommand |
| `src/commands/list.ts` | `list [domains|profiles|artifacts]` subcommand |
| `src/commands/sync.ts` | `sync <path> [--dry-run]` subcommand |
| `src/commands/init.ts` | `init <path>` subcommand |
| `src/manifest/schema.ts` | zod schema for `.agent-library.yml` |
| `src/manifest/load.ts` | read + parse manifest from a path |
| `src/manifest/validate.ts` | structural + reference checks, returns issue list |
| `src/resolve/sources.ts` | resolve includes to concrete artifact descriptors |
| `src/resolve/profiles.ts` | load profile files, reject nested profile refs |
| `src/resolve/bundles.ts` | expand a directory include into its artifacts |
| `src/resolve/project.ts` | resolve `./` paths against project local source root |
| `src/artifact/types.ts` | `ArtifactKind`, `Artifact`, `ArtifactFile` types |
| `src/artifact/discover.ts` | walk a domain folder; classify skills / commands / agents |
| `src/artifact/target.ts` | compute flattened target paths per artifact |
| `src/artifact/collision.ts` | reject duplicate target paths across includes |
| `src/sync/plan.ts` | build the full sync plan from manifest + sources |
| `src/sync/header.ts` | render generated and vendored HTML-comment headers |
| `src/sync/adapters.ts` | merge neutral source + target adapter into final body |
| `src/sync/generated.ts` | generated-mode write + stale-file cleanup |
| `src/sync/vendored.ts` | vendored-mode write + lockfile-gated update |
| `src/sync/summary.ts` | print final sync summary |
| `src/lockfile/schema.ts` | zod schema for lockfile shape |
| `src/lockfile/read.ts` | read previous lockfile, tolerate missing |
| `src/lockfile/write.ts` | serialize and write `.agent-library.lock` |
| `src/lockfile/hash.ts` | SHA-256 hash of file bytes; helpers for streams |
| `src/util/fs.ts` | `mkdirp`, `writeFileAtomic`, `readFileMaybe` |
| `src/util/home.ts` | resolve home library root from `--home`, `HOME_AGENT_LIBRARY`, or `~/.agent-library` |
| `src/util/yaml.ts` | thin `yaml` wrapper with safe parse/stringify helpers |
| `src/util/paths.ts` | path helpers: domain split, basename, normalization |
| `tests/fixtures/manifests/*.yml` | valid + invalid manifest fixtures |
| `tests/fixtures/home-min/**` | minimal fixture library tree used by sync tests |
| `tests/fixtures/project-local/**` | project with its own `.agent-library/` source |
| `tests/integration/*.test.ts` | command-level integration tests (run the bundled CLI) |
| `tests/unit/*.test.ts` | per-module unit tests |

Files exceed 300 lines? `src/sync/plan.ts` is the highest-risk; if it grows beyond ~250 lines, split into `plan-build.ts` + `plan-collisions.ts` during slice 5 review.

**Sequencing dependencies (same-file edits):**
- `src/sync/plan.ts` is touched by tasks 4, 5, 6, 7, 8 — **strictly sequential**.
- `src/manifest/validate.ts` is touched by tasks 2, 3, 5 — **strictly sequential**.
- `src/lockfile/schema.ts` is touched by tasks 7, 8 — task 8 extends to record original-include + bundle expansion.

---

## Task 1: Project bootstrap + CLI skeleton

**Type:** AFK
**Blocked by:** —
**Demoable:** `bun run build && ./bin/agent-library --version` prints the package version. `bun test` runs one passing smoke test.

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/cli.ts`
- Generated by build: `bin/agent-library`
- Test: `tests/integration/cli-smoke.test.ts`

**Steps:**

- [ ] Initialize Bun and add deps:
  ```bash
  cd /home/alifarooq/.agent-library
  bun init -y
  bun add commander @clack/prompts zod yaml chalk
  bun add -d typescript @types/bun
  ```
- [ ] Create `package.json` fields (merge into the generated file):
  ```json
  {
    "name": "agent-library",
    "version": "0.1.0",
    "type": "module",
    "bin": { "agent-library": "./bin/agent-library" },
    "scripts": {
      "build": "bun build src/cli.ts --compile --target=bun-linux-x64 --outfile bin/agent-library",
      "typecheck": "tsc --noEmit",
      "dev": "bun run src/cli.ts",
      "test": "bun test",
      "check": "bun run typecheck && bun test"
    }
  }
  ```
- [ ] Create `tsconfig.json` with `"target": "ESNext"`, `"module": "Preserve"`, `"moduleResolution": "bundler"`, `"moduleDetection": "force"`, `"strict": true`, `"types": ["bun"]`, `"allowImportingTsExtensions": true`, `"verbatimModuleSyntax": true`, `"resolveJsonModule": true`, `"noEmit": true`, `"esModuleInterop": true`, `"skipLibCheck": true`, `"include": ["src/**/*.ts", "tests/**/*.ts"]`.
- [ ] Create `src/cli.ts`:
  ```ts
  import { Command } from 'commander';
  import pkg from '../package.json' with { type: 'json' };

  const program = new Command()
    .name('agent-library')
    .description('Agent library sync tool')
    .version(pkg.version);

  program.parse();
  ```
- [ ] Create `.gitignore`:
  ```gitignore
  node_modules/
  bin/agent-library
  tests/fixtures/**/.agents/
  tests/fixtures/**/.claude/
  tests/fixtures/**/.agent-library.lock
  ```
- [ ] Write smoke test `tests/integration/cli-smoke.test.ts`:
  ```ts
  import { execFileSync } from 'node:child_process';
  import { describe, it, expect } from 'bun:test';

  describe('cli smoke', () => {
    it('prints version matching package.json', () => {
      const out = execFileSync('./bin/agent-library', ['--version'], { encoding: 'utf8' });
      expect(out.trim()).toBe('0.1.0');
    });
  });
  ```
- [ ] Run: `bun test` → **Expected: FAIL** with `./bin/agent-library` not found because the executable has not been built.
- [ ] Run: `bun run build && bun test` → **Expected: PASS** for `cli smoke > prints version matching package.json`.
- [ ] Commit:
  ```bash
  git add package.json bun.lock tsconfig.json .gitignore src/cli.ts tests/integration/cli-smoke.test.ts
  git commit -m "feat: bootstrap agent-library CLI with bun and commander"
  ```

---

## Task 2: Manifest schema + `validate` (structural checks)

**Type:** AFK
**Blocked by:** Task 1
**Demoable:** `agent-library validate <fixture-project-root>` exits 0 when `<fixture-project-root>/.agent-library.yml` is valid; manifests missing `version`, `mode`, `target`, or `include` exit 1 with a field-specific error naming the offending field.

**Files:**
- Create: `src/manifest/schema.ts`, `src/manifest/load.ts`, `src/manifest/validate.ts`, `src/commands/validate.ts`, `src/util/yaml.ts`
- Modify: `src/cli.ts` (register `validate` subcommand)
- Test: `tests/unit/manifest.test.ts`, `tests/integration/validate.test.ts`
- Fixtures: `tests/fixtures/manifests/valid.yml`, `tests/fixtures/manifests/missing-version.yml`, `tests/fixtures/manifests/bad-mode.yml`, `tests/fixtures/manifests/empty-include.yml`, `tests/fixtures/manifests/bad-target.yml`, plus project-root fixtures under `tests/fixtures/projects/validate-*`

**Steps:**

- [ ] Create fixture manifests:
  - `valid.yml`:
    ```yaml
    version: 1
    mode: generated
    target: both
    include:
      - global/skills/writing-plans
    ```
  - `missing-version.yml`: same but no `version:` line.
  - `bad-mode.yml`: `mode: weird` (others valid).
  - `bad-target.yml`: `target: gemini` (others valid).
  - `empty-include.yml`: `include: []` (others valid).
- [ ] Create project-root validation fixtures:
  - `tests/fixtures/projects/validate-valid/.agent-library.yml` copied from `valid.yml`.
  - `tests/fixtures/projects/validate-missing-version/.agent-library.yml` copied from `missing-version.yml`.
- [ ] Write unit tests `tests/unit/manifest.test.ts`:
  ```ts
  import { describe, it, expect } from 'bun:test';
  import { validateManifest } from '../../src/manifest/validate.ts';
  import { loadManifest } from '../../src/manifest/load.ts';

  describe('validateManifest', () => {
    it('accepts a fully populated valid manifest', () => {
      const m = loadManifest('tests/fixtures/manifests/valid.yml');
      const issues = validateManifest(m);
      expect(issues).toEqual([]);
    });

    it('rejects missing version with a field-specific message', () => {
      const m = loadManifest('tests/fixtures/manifests/missing-version.yml');
      const issues = validateManifest(m);
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toBe('version');
      expect(issues[0].message).toMatch(/required/i);
    });

    it('rejects unknown mode value', () => {
      const m = loadManifest('tests/fixtures/manifests/bad-mode.yml');
      const issues = validateManifest(m);
      expect(issues[0].path).toBe('mode');
      expect(issues[0].message).toMatch(/generated|vendored/);
    });

    it('rejects unknown target value', () => {
      const m = loadManifest('tests/fixtures/manifests/bad-target.yml');
      const issues = validateManifest(m);
      expect(issues[0].path).toBe('target');
    });

    it('rejects empty include array', () => {
      const m = loadManifest('tests/fixtures/manifests/empty-include.yml');
      const issues = validateManifest(m);
      expect(issues[0].path).toBe('include');
      expect(issues[0].message).toMatch(/non-empty|at least one/i);
    });
  });
  ```
- [ ] Run: `bun test tests/unit/manifest.test.ts` → **Expected: FAIL** with `Cannot find module '../../src/manifest/validate.ts'`.
- [ ] Implement `src/util/yaml.ts`:
  ```ts
  import { parse } from 'yaml';
  import { readFileSync } from 'node:fs';
  export function readYaml<T = unknown>(path: string): T {
    return parse(readFileSync(path, 'utf8')) as T;
  }
  ```
- [ ] Implement `src/manifest/schema.ts` with a zod schema:
  ```ts
  import { z } from 'zod';
  export const ManifestSchema = z.object({
    version: z.literal(1, { message: 'version must be 1' }),
    mode: z.enum(['generated', 'vendored'], { message: 'mode must be generated or vendored' }),
    target: z.enum(['codex', 'claude', 'both'], { message: 'target must be codex, claude, or both' }),
    include: z.array(z.string()).nonempty({ message: 'include must be a non-empty list' }),
  });
  export type Manifest = z.infer<typeof ManifestSchema>;
  ```
- [ ] Implement `src/manifest/load.ts` (read raw YAML; do not validate yet — caller decides).
- [ ] Implement `src/manifest/validate.ts`:
  ```ts
  import { ManifestSchema } from './schema.ts';
  export interface Issue { path: string; message: string }
  export function validateManifest(input: unknown): Issue[] {
    const r = ManifestSchema.safeParse(input);
    if (r.success) return [];
    return r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
  }
  ```
- [ ] Run: `bun test tests/unit/manifest.test.ts` → **Expected: PASS** for all five cases.
- [ ] Write integration test `tests/integration/validate.test.ts`:
  ```ts
  import { execFileSync } from 'node:child_process';
  import { describe, it, expect } from 'bun:test';

  function run(args: string[]): { stdout: string; stderr: string; code: number } {
    try {
      const stdout = execFileSync('./bin/agent-library', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { stdout, stderr: '', code: 0 };
    } catch (e: any) {
      return { stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '', code: e.status ?? 1 };
    }
  }

  describe('validate command', () => {
    it('exits 0 for a valid manifest', () => {
      const r = run(['validate', 'tests/fixtures/projects/validate-valid']);
      expect(r.code).toBe(0);
    });
    it('exits 1 and names the missing version field', () => {
      const r = run(['validate', 'tests/fixtures/projects/validate-missing-version']);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/version/);
    });
  });
  ```
- [ ] Implement `src/commands/validate.ts` using commander. It accepts a positional install target root, loads `<path>/.agent-library.yml`, calls `validateManifest`, prints issues to `stderr` (`<field>: <message>` per line), and exits 1 if any.
- [ ] Register the subcommand in `src/cli.ts` by importing the validate command module and adding it to the root Commander program.
- [ ] Run: `bun run build && bun test tests/integration/validate.test.ts` → **Expected: PASS** for both cases.
- [ ] Commit:
  ```bash
  git add src tests/fixtures/manifests tests/unit/manifest.test.ts tests/integration/validate.test.ts
  git commit -m "feat: validate command with manifest schema and field-level errors"
  ```

---

## Task 3: Source resolution + `list` command

**Type:** AFK
**Blocked by:** Task 2
**Demoable:** `agent-library list artifacts --domain frontend` (against a fixture library) prints expanded artifact IDs one per line. `validate` now also rejects unresolvable include entries and any `profile:` reference inside a profile file.

**Files:**
- Create: `src/resolve/sources.ts`, `src/resolve/profiles.ts`, `src/resolve/bundles.ts`, `src/artifact/types.ts`, `src/artifact/discover.ts`, `src/commands/list.ts`, `src/util/home.ts`, `src/util/paths.ts`
- Modify: `src/manifest/validate.ts` (add reference-resolution checks), `src/cli.ts` (register `list`)
- Test: `tests/unit/resolve.test.ts`, `tests/integration/list.test.ts`
- Fixtures: `tests/fixtures/home-min/global/skills/writing-plans/SKILL.md`, `tests/fixtures/home-min/frontend/skills/react-useeffect/SKILL.md`, `tests/fixtures/home-min/frontend/skills/shadcn/SKILL.md`, `tests/fixtures/home-min/global/agents/security-reviewer.md`, `tests/fixtures/home-min/global/commands/review-pr.md`, `tests/fixtures/home-min/profiles/universal.yml`, `tests/fixtures/home-min/profiles/frontend.yml`, `tests/fixtures/home-min/profiles/nested.yml`

**Steps:**

- [ ] Build the fixture library tree under `tests/fixtures/home-min/` with the artifacts listed above. Each `SKILL.md` MUST start with frontmatter that includes `name: <folder-basename>`. Profile files:
  - `universal.yml`: `include: [global]`
  - `frontend.yml`: `include: [global, frontend/skills/react-useeffect, frontend/skills/shadcn]`
  - `nested.yml`: `include: [profile:frontend]` (used to test the nested-profile rejection)
- [ ] Define types in `src/artifact/types.ts`:
  ```ts
  export type ArtifactKind = 'skill' | 'command' | 'agent';
  export interface Artifact {
    id: string;          // domain-qualified path, e.g. 'frontend/skills/react-useeffect'
    kind: ArtifactKind;
    sourceRoot: string;  // absolute path to the artifact root (folder for skills, file for command/agent)
    domain: string;      // 'frontend'
    basename: string;    // 'react-useeffect'
    libraryRoot: string; // absolute path to the home or project library root that owns it
  }
  ```
- [ ] Write unit tests `tests/unit/resolve.test.ts`:
  ```ts
  import { describe, it, expect } from 'bun:test';
  import { resolveIncludes } from '../../src/resolve/sources.ts';
  import { resolve } from 'node:path';

  const HOME = resolve('tests/fixtures/home-min');

  describe('resolveIncludes', () => {
    it('resolves a concrete skill path', () => {
      const arts = resolveIncludes(['frontend/skills/react-useeffect'], { homeRoot: HOME, projectRoot: null });
      expect(arts.map(a => a.id)).toEqual(['frontend/skills/react-useeffect']);
      expect(arts[0].kind).toBe('skill');
    });

    it('expands a bundle directory into its artifacts', () => {
      const arts = resolveIncludes(['global'], { homeRoot: HOME, projectRoot: null });
      const ids = arts.map(a => a.id).sort();
      expect(ids).toEqual([
        'global/agents/security-reviewer',
        'global/commands/review-pr',
        'global/skills/writing-plans',
      ]);
    });

    it('expands a profile reference', () => {
      const arts = resolveIncludes(['profile:frontend'], { homeRoot: HOME, projectRoot: null });
      const ids = arts.map(a => a.id);
      expect(ids).toContain('frontend/skills/react-useeffect');
      expect(ids).toContain('frontend/skills/shadcn');
      expect(ids).toContain('global/skills/writing-plans');
    });

    it('throws on a profile that includes another profile', () => {
      expect(() => resolveIncludes(['profile:nested'], { homeRoot: HOME, projectRoot: null }))
        .toThrow(/profile.*may not include.*profile/i);
    });

    it('throws on an unresolvable include', () => {
      expect(() => resolveIncludes(['frontend/skills/does-not-exist'], { homeRoot: HOME, projectRoot: null }))
        .toThrow(/cannot resolve/i);
    });
  });
  ```
- [ ] Run: `bun test tests/unit/resolve.test.ts` → **Expected: FAIL** with module-not-found for `resolve/sources.ts`.
- [ ] Implement `src/util/paths.ts` (helpers: `splitDomain`, `isProfileRef`, `isLocalRef` for `./` paths).
- [ ] Implement `src/artifact/discover.ts`:
  - For a directory like `<libraryRoot>/<domain>/skills/<name>/`, return a `skill` artifact when `SKILL.md` exists.
  - For `<libraryRoot>/<domain>/commands/<name>.md`, return a `command` artifact.
  - For `<libraryRoot>/<domain>/agents/<name>.md`, return an `agent` artifact.
  - Walk a domain root and return all artifacts under it, sorted by id.
- [ ] Implement `src/resolve/profiles.ts`:
  ```ts
  // loadProfile(homeRoot, name): returns string[] of include entries.
  // Throws if any entry starts with 'profile:'.
  ```
- [ ] Implement `src/resolve/bundles.ts` (`expandBundle(libraryRoot, idPath): Artifact[]`).
- [ ] Implement `src/util/home.ts` with shared home root resolution priority: `--home` flag → `HOME_AGENT_LIBRARY` env → `~/.agent-library`. `validate`, `list`, and `sync` must use this helper whenever they resolve home-library includes.
- [ ] Implement `src/resolve/sources.ts`:
  ```ts
  export interface ResolveCtx { homeRoot: string; projectRoot: string | null }
  export function resolveIncludes(entries: string[], ctx: ResolveCtx): Artifact[] {
    const out: Artifact[] = [];
    for (const e of entries) {
      if (e.startsWith('profile:')) {
        const inner = loadProfile(ctx.homeRoot, e.slice('profile:'.length));
        out.push(...resolveIncludes(inner, ctx)); // profiles can reference bundles + paths but NOT other profiles (loadProfile already enforced)
      } else if (e.startsWith('./')) {
        // project-local — implemented in Task 9; for this task throw 'project-local includes not yet supported'
        throw new Error('project-local includes are not supported in this task');
      } else {
        out.push(...resolveOne(ctx.homeRoot, e));
      }
    }
    return out;
  }
  ```
  `resolveOne` decides: concrete artifact (returns one) or bundle directory (returns many via `expandBundle`). Throws `cannot resolve <id>` if neither.
- [ ] Run: `bun test tests/unit/resolve.test.ts` → **Expected: PASS** for all five cases.
- [ ] Extend `src/manifest/validate.ts` to optionally take a `ResolveCtx` and surface unresolvable includes / nested-profile errors as additional issues (path = `include[i]`).
- [ ] Implement `src/commands/list.ts` with subcommands: `domains`, `profiles`, `artifacts` (supports `--home`, `--domain`, `--type`). All use `discoverDomain` over `homeRoot`.
- [ ] Write integration test `tests/integration/list.test.ts` covering all four list modes (set `HOME_AGENT_LIBRARY=tests/fixtures/home-min` for each):
  - `list domains` → stdout contains `global` and `frontend`.
  - `list profiles` → stdout contains `universal` and `frontend`.
  - `list artifacts` → stdout contains `frontend/skills/react-useeffect`, `global/skills/writing-plans`, `global/agents/security-reviewer`, `global/commands/review-pr`.
  - `list artifacts --domain frontend` → stdout contains `frontend/skills/react-useeffect` and `frontend/skills/shadcn`; does NOT contain `global/skills/writing-plans`.
  - `list artifacts --type skills --domain global` → stdout contains `global/skills/writing-plans`; does NOT contain `global/agents/security-reviewer`.
  Implementation note: tests use the `HOME_AGENT_LIBRARY` env override from the shared home root resolver.
- [ ] Run: `bun run build && bun test tests/integration/list.test.ts` → **Expected: PASS**.
- [ ] Commit:
  ```bash
  git add src tests/fixtures/home-min tests/unit/resolve.test.ts tests/integration/list.test.ts
  git commit -m "feat: source resolution and list command with profile and bundle expansion"
  ```

---

## Task 4: Generated sync — skills only, single target

**Type:** AFK
**Blocked by:** Task 3
**Demoable:** With a manifest `mode: generated, target: claude, include: [frontend/skills/react-useeffect]` against `home-min`, running sync writes `<projectRoot>/.claude/skills/react-useeffect/SKILL.md` whose first non-blank line is the generated marker, followed by the neutral source body. Sync fails when the SKILL.md frontmatter `name:` does not match the folder basename.

**Files:**
- Create: `src/sync/plan.ts`, `src/sync/header.ts`, `src/sync/generated.ts`, `src/sync/summary.ts`, `src/util/fs.ts`, `src/artifact/target.ts`, `src/commands/sync.ts`
- Modify: `src/manifest/validate.ts` (add SKILL.md `name:` frontmatter check), `src/cli.ts` (register `sync`)
- Test: `tests/unit/header.test.ts`, `tests/integration/sync-generated-skill.test.ts`
- Fixtures: `tests/fixtures/projects/p1-skill-only/.agent-library.yml`, plus a `tests/fixtures/home-min/frontend/skills/bad-name/SKILL.md` whose frontmatter `name: wrong` doesn't match `bad-name`

**Steps:**

- [ ] Build fixture: `tests/fixtures/projects/p1-skill-only/.agent-library.yml`:
  ```yaml
  version: 1
  mode: generated
  target: claude
  include:
    - frontend/skills/react-useeffect
  ```
- [ ] Add `tests/fixtures/home-min/frontend/skills/bad-name/SKILL.md` with frontmatter `name: wrong`.
- [ ] Write unit test `tests/unit/header.test.ts`:
  ```ts
  import { describe, it, expect } from 'bun:test';
  import { renderGeneratedHeader } from '../../src/sync/header.ts';

  describe('renderGeneratedHeader', () => {
    it('produces the canonical generated marker with source path', () => {
      const h = renderGeneratedHeader({ source: 'frontend/skills/react-useeffect', mode: 'generated' });
      expect(h).toContain('Generated by agent-library');
      expect(h).toContain('Source: frontend/skills/react-useeffect');
      expect(h).toContain('Mode: generated');
      expect(h.startsWith('<!--')).toBe(true);
      expect(h.trimEnd().endsWith('-->')).toBe(true);
    });
  });
  ```
- [ ] Run: `bun test tests/unit/header.test.ts` → **Expected: FAIL** module not found.
- [ ] Implement `src/sync/header.ts` matching the spec's example header text exactly (generated and vendored variants in one file, switched by `mode`).
- [ ] Implement `src/util/fs.ts` (`mkdirp`, `writeFileAtomic` using `fs.writeFileSync` to `path + '.tmp'` then `rename`).
- [ ] Implement `src/artifact/target.ts`:
  ```ts
  // For an Artifact, return the list of target file specs given a target setting.
  // Skill: <target>/skills/<basename>/SKILL.md
  // Command: <target>/commands/<basename>.md
  // Agent: <target>/agents/<basename>.md
  // target=both yields one spec per (.agents, .claude).
  ```
- [ ] Implement `src/sync/plan.ts`:
  ```ts
  export interface PlanFileWrite {
    artifactId: string;
    sourceFile: string;       // absolute path
    targetFile: string;       // absolute path under projectRoot
    isMarkdown: boolean;
  }
  export interface SyncPlan {
    mode: 'generated' | 'vendored';
    target: 'codex' | 'claude' | 'both';
    writes: PlanFileWrite[];
  }
  export function buildPlan(manifest, artifacts, projectRoot): SyncPlan { /* ... */ }
  ```
  In this task, only handle `kind === 'skill'`'s `SKILL.md`. Other kinds and bundled files come in Task 5.
- [ ] Implement `src/sync/generated.ts` (`runGeneratedSync(plan)`): for each write, render header for `.md` files, concatenate header + source body, write atomically. Return counts.
- [ ] Extend `src/manifest/validate.ts`: for each resolved `skill` artifact, parse the first YAML frontmatter block of `SKILL.md` and compare `name` to the folder basename. Issue `path: include[i]`, `message: SKILL.md name '<x>' does not match folder basename '<y>'`.
- [ ] Implement `src/commands/sync.ts`: load manifest from `<path>/.agent-library.yml`, validate, resolve with the shared home root resolver, plan, run generated mode (only mode supported in this task; vendored returns "not yet implemented" until Task 8).
- [ ] Register `sync` in `src/cli.ts`.
- [ ] Write integration test `tests/integration/sync-generated-skill.test.ts`:
  ```ts
  // 1. Run sync on tests/fixtures/projects/p1-skill-only with HOME_AGENT_LIBRARY=tests/fixtures/home-min.
  // 2. Read tests/fixtures/projects/p1-skill-only/.claude/skills/react-useeffect/SKILL.md.
  // 3. Assert: starts with the generated marker; contains the original SKILL.md body.
  // 4. Cleanup: remove the .claude/ directory after assertions (afterEach).
  // 5. Negative: a manifest including frontend/skills/bad-name exits 1 with stderr matching /name.*does not match/.
  ```
- [ ] Run: `bun run build && bun test tests/integration/sync-generated-skill.test.ts` → **Expected: PASS**.
- [ ] Commit:
  ```bash
  git add src tests/fixtures tests/unit/header.test.ts tests/integration/sync-generated-skill.test.ts
  git commit -m "feat: generated sync for skills with name-frontmatter validation"
  ```

---

## Task 5: Generated sync — commands, agents, dual targets, collision detection

**Type:** AFK
**Blocked by:** Task 4
**Demoable:** With `target: both, include: [global/skills/writing-plans, global/commands/review-pr, global/agents/security-reviewer]`, sync writes the same canonical files to both `.agents/` and `.claude/`. A manifest including two artifacts that map to the same flattened target path exits 1 with both source paths named.

**Files:**
- Create: `src/artifact/collision.ts`, `tests/fixtures/projects/p2-mixed/.agent-library.yml`, `tests/fixtures/projects/p3-collision/.agent-library.yml`, `tests/fixtures/home-min/security/skills/review/SKILL.md`, `tests/fixtures/home-min/testing/skills/review/SKILL.md`
- Modify: `src/sync/plan.ts` (add command, agent, bundled-skill files), `src/manifest/validate.ts` (collision check)
- Test: `tests/unit/collision.test.ts`, `tests/integration/sync-mixed.test.ts`, `tests/integration/sync-collision.test.ts`

**Steps:**

- [ ] Build fixtures:
  - `p2-mixed/.agent-library.yml`:
    ```yaml
    version: 1
    mode: generated
    target: both
    include:
      - global/skills/writing-plans
      - global/commands/review-pr
      - global/agents/security-reviewer
    ```
  - `p3-collision/.agent-library.yml`: include `security/skills/review` and `testing/skills/review` (both already added under `home-min`).
- [ ] Write unit test `tests/unit/collision.test.ts`:
  ```ts
  it('flags duplicate target paths and names both sources', () => {
    const issues = detectCollisions([
      { artifactId: 'security/skills/review', targetPath: '.claude/skills/review/SKILL.md' },
      { artifactId: 'testing/skills/review',  targetPath: '.claude/skills/review/SKILL.md' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('security/skills/review');
    expect(issues[0].message).toContain('testing/skills/review');
    expect(issues[0].message).toContain('.claude/skills/review/SKILL.md');
  });
  ```
- [ ] Run: `bun test tests/unit/collision.test.ts` → **Expected: FAIL**.
- [ ] Implement `src/artifact/collision.ts`: group by `targetPath`, return one issue per group of size > 1.
- [ ] Extend `src/sync/plan.ts`:
  - Handle `kind === 'command'`: one `PlanFileWrite` per target.
  - Handle `kind === 'agent'`: one `PlanFileWrite` per target.
  - Handle bundled files inside a skill folder (anything under the skill folder that is not the `adapters/` directory) — copy verbatim. For markdown, prepend the generated header; for non-markdown, copy bytes (mark `isMarkdown: false`). The spec is silent on non-markdown, so this is the documented behavior.
- [ ] Wire `detectCollisions` into the sync command path: after building the plan, run collision detection on the flat `writes[].targetFile` set; abort the sync with exit 1 if any.
- [ ] Run: `bun test tests/unit/collision.test.ts` → **Expected: PASS**.
- [ ] Write integration test `tests/integration/sync-mixed.test.ts`: run sync against `p2-mixed`; assert all six target files exist (3 artifacts × 2 targets) with generated headers. Cleanup `.agents/` and `.claude/` afterward.
- [ ] Write integration test `tests/integration/sync-collision.test.ts`: run sync against `p3-collision`; expect exit 1; stderr names both source IDs and the conflicting target path.
- [ ] Run: `bun run build && bun test tests/integration/sync-mixed.test.ts tests/integration/sync-collision.test.ts` → **Expected: PASS**.
- [ ] Commit:
  ```bash
  git add src tests/fixtures tests/unit/collision.test.ts tests/integration/sync-mixed.test.ts tests/integration/sync-collision.test.ts
  git commit -m "feat: generated sync covers commands, agents, dual targets, with collision detection"
  ```

---

## Task 6: Adapters — additive target-specific notes

**Type:** AFK
**Blocked by:** Task 5
**Demoable:** A skill with `adapters/claude.md` produces a `.claude` target whose body equals `header + neutral SKILL.md + adapter content`. The same artifact written to `.agents` omits the claude adapter (uses `adapters/codex.md` if present, otherwise just `header + neutral source`). A standalone subagent at `global/agents/security-reviewer.md` with sibling `security-reviewer.adapters/claude.md` produces the same merge for the `.claude` target.

**Files:**
- Create: `src/sync/adapters.ts`, `tests/unit/adapters.test.ts`, `tests/integration/sync-adapters.test.ts`, `tests/fixtures/projects/p4-adapters/.agent-library.yml`
- Modify: `src/sync/plan.ts` (record per-target adapter source), `src/sync/generated.ts` (apply adapter merge during write)
- Add: `tests/fixtures/home-min/frontend/skills/react-useeffect/adapters/claude.md` and `adapters/codex.md` (small distinct content), and `tests/fixtures/home-min/global/agents/security-reviewer.adapters/claude.md`

**Steps:**

- [ ] Add adapter files with a one-line distinguishing marker each:
  - `adapters/claude.md`: `Claude-specific note: prefer Sonnet for this skill.`
  - `adapters/codex.md`: `Codex-specific note: invoke via /skill.`
  - `security-reviewer.adapters/claude.md`: `Claude variant: use the security-reviewer subagent.`
- [ ] Write unit test `tests/unit/adapters.test.ts`:
  ```ts
  it('combines header + neutral source + adapter, in that order', () => {
    const out = mergeWithAdapter({
      header: '<!-- HDR -->',
      neutral: '# Body\n',
      adapter: 'Adapter line.\n',
    });
    expect(out).toBe('<!-- HDR -->\n# Body\nAdapter line.\n');
  });

  it('omits adapter when null', () => {
    const out = mergeWithAdapter({ header: '<!-- HDR -->', neutral: '# Body\n', adapter: null });
    expect(out).toBe('<!-- HDR -->\n# Body\n');
  });
  ```
- [ ] Run: `bun test tests/unit/adapters.test.ts` → **Expected: FAIL**.
- [ ] Implement `src/sync/adapters.ts` with `mergeWithAdapter` and `findAdapter(artifact, target): { sourcePath, content } | null`. Adapter discovery rules:
  - Skill: `<artifact.sourceRoot>/adapters/<target>.md`
  - Command/Agent: sibling `<artifact.basename>.adapters/<target>.md`
  - `target` here is `claude` or `codex` (not `both`); `both` resolves per-side.
- [ ] Extend `src/sync/plan.ts`: each `PlanFileWrite` for the SKILL.md / command / agent file carries an optional `adapterSource: string | null` per-target spec.
- [ ] Update `src/sync/generated.ts`: for the markdown write, call `mergeWithAdapter` with the per-target adapter content; record `adapterSource` so it can be hashed in Task 7.
- [ ] Run: `bun test tests/unit/adapters.test.ts` → **Expected: PASS**.
- [ ] Build fixture `p4-adapters` (manifest target: both, includes `frontend/skills/react-useeffect` and `global/agents/security-reviewer`).
- [ ] Write integration test `tests/integration/sync-adapters.test.ts`:
  - Sync `p4-adapters`, then assert:
    - `.claude/skills/react-useeffect/SKILL.md` contains `Claude-specific note`.
    - `.agents/skills/react-useeffect/SKILL.md` contains `Codex-specific note` and NOT `Claude-specific note`.
    - `.claude/agents/security-reviewer.md` contains `Claude variant`.
    - `.agents/agents/security-reviewer.md` does NOT contain `Claude variant` (no codex adapter exists for security-reviewer in the fixture).
- [ ] Run: `bun run build && bun test tests/integration/sync-adapters.test.ts` → **Expected: PASS**.
- [ ] Commit:
  ```bash
  git add src tests/fixtures/home-min/frontend/skills/react-useeffect/adapters tests/fixtures/home-min/global/agents/security-reviewer.adapters tests/fixtures/projects/p4-adapters tests/unit/adapters.test.ts tests/integration/sync-adapters.test.ts
  git commit -m "feat: adapter merge for skills and standalone subagents"
  ```

---

## Task 7: Lockfile + generated stale-file cleanup

**Type:** AFK
**Blocked by:** Task 6
**Demoable:** First sync writes a schema-valid `.agent-library.lock` recording every artifact, file, target, source hash, target hash, and adapter hash. Removing an entry from the manifest and re-syncing deletes the previously written generated files and reports `Removed stale generated files: N` in the summary. The CLI must NOT delete files lacking the generated marker.

**Files:**
- Create: `src/lockfile/schema.ts`, `src/lockfile/read.ts`, `src/lockfile/write.ts`, `src/lockfile/hash.ts`, `src/sync/cleanup.ts`, `tests/unit/lockfile.test.ts`, `tests/unit/hash.test.ts`, `tests/integration/sync-lockfile.test.ts`, `tests/integration/sync-stale-cleanup.test.ts`
- Modify: `src/sync/generated.ts` (write lockfile, run cleanup), `src/sync/summary.ts` (report stale removals)

**Steps:**

- [ ] Define lockfile schema in `src/lockfile/schema.ts`:
  ```ts
  export const LockfileSchema = z.object({
    version: z.literal(1),
    cliVersion: z.string(),
    mode: z.enum(['generated', 'vendored']),
    target: z.enum(['codex', 'claude', 'both']),
    syncedAt: z.string(),                   // ISO 8601
    include: z.array(z.string()),           // original manifest entries
    artifacts: z.array(z.object({
      id: z.string(),
      kind: z.enum(['skill', 'command', 'agent']),
      files: z.array(z.object({
        source: z.string(),                 // path relative to libraryRoot
        sourceHash: z.string(),             // sha256 hex
        targets: z.array(z.object({
          path: z.string(),                 // path relative to projectRoot
          targetHash: z.string(),
          adapterSource: z.string().nullable(),
          adapterHash: z.string().nullable(),
        })),
      })),
    })),
  });
  export type Lockfile = z.infer<typeof LockfileSchema>;
  ```
- [ ] Write unit test `tests/unit/hash.test.ts`:
  ```ts
  it('produces stable sha256 for the same bytes', () => {
    expect(hashBytes(Buffer.from('hello'))).toBe(hashBytes(Buffer.from('hello')));
    expect(hashBytes(Buffer.from('hello'))).toMatch(/^[0-9a-f]{64}$/);
  });
  ```
- [ ] Write unit test `tests/unit/lockfile.test.ts`:
  ```ts
  it('round-trips a lockfile through write + read', () => {
    const fix: Lockfile = { /* minimal valid object */ };
    writeLockfile('/tmp/al-test.lock', fix);
    expect(readLockfile('/tmp/al-test.lock')).toEqual(fix);
  });
  it('returns null when no lockfile exists', () => {
    expect(readLockfile('/tmp/does-not-exist.lock')).toBeNull();
  });
  ```
- [ ] Run: `bun test tests/unit/hash.test.ts tests/unit/lockfile.test.ts` → **Expected: FAIL**.
- [ ] Implement `src/lockfile/hash.ts` (sha256 of file bytes via `crypto.createHash`).
- [ ] Implement `src/lockfile/read.ts` and `src/lockfile/write.ts` (YAML serialization via `yaml`; schema-validate on read; tolerate missing file by returning `null`).
- [ ] Run: `bun test tests/unit/hash.test.ts tests/unit/lockfile.test.ts` → **Expected: PASS**.
- [ ] Implement `src/sync/cleanup.ts`:
  ```ts
  // Diff previousLockfile.artifacts[].files[].targets[].path against newPlan target paths.
  // For each removed target path: read file; if it does not start with the generated marker, log a warning and skip.
  // Else delete the file. Then walk parent directories and remove any that became empty.
  // Return { removed: number, skipped: { path, reason }[] }.
  ```
- [ ] Modify `src/sync/generated.ts` to:
  1. Read the previous lockfile (if any) before writing.
  2. After writes complete, hash every source / adapter / target for the new lockfile entry.
  3. Run cleanup with the previous lockfile.
  4. Write the new lockfile with `cliVersion = pkg.version` and `syncedAt = new Date().toISOString()`.
- [ ] Update `src/sync/summary.ts` to print:
  ```text
  Agent library sync complete
  Root: <projectRoot>
  Mode: <mode>
  Target: <target>
  Skills: <n>
  Commands: <n>
  Agents: <n>
  Removed stale generated files: <n>
  Lockfile: .agent-library.lock
  ```
- [ ] Write integration test `tests/integration/sync-lockfile.test.ts`: sync `p2-mixed`; load `.agent-library.lock`; assert it parses through `LockfileSchema`; assert `cliVersion === '0.1.0'`, `artifacts.length === 3`, every file's `sourceHash` matches recomputed hash on disk.
- [ ] Write integration test `tests/integration/sync-stale-cleanup.test.ts`:
  1. Sync `p2-mixed` (3 artifacts, target both → 6 files).
  2. Rewrite the manifest to include only `global/skills/writing-plans`.
  3. Sync again.
  4. Assert: stdout contains `Removed stale generated files: 4`; the command and agent target files no longer exist.
  5. Manually create an unmarked `.claude/skills/writing-plans/notes.md` with no header; sync again with the same manifest; assert the unmarked file still exists.
- [ ] Run: `bun run build && bun test tests/integration/sync-lockfile.test.ts tests/integration/sync-stale-cleanup.test.ts` → **Expected: PASS**.
- [ ] Commit:
  ```bash
  git add src tests/unit/hash.test.ts tests/unit/lockfile.test.ts tests/integration/sync-lockfile.test.ts tests/integration/sync-stale-cleanup.test.ts
  git commit -m "feat: lockfile schema and stale-file cleanup for generated mode"
  ```

---

## Task 8: Vendored mode

**Type:** AFK
**Blocked by:** Task 7
**Demoable:** First vendored sync writes target files with the vendored header and a lockfile that records target hashes. Re-syncing after a source change updates only files whose on-disk hash matches the lockfile's previous target hash. A locally edited vendored file is left untouched and reported on stderr as a conflict naming the source artifact.

**Files:**
- Create: `src/sync/vendored.ts`, `tests/integration/sync-vendored.test.ts`, `tests/fixtures/projects/p5-vendored/.agent-library.yml`
- Modify: `src/sync/header.ts` (vendored variant), `src/commands/sync.ts` (route on `mode`), `src/sync/summary.ts` (report skipped files)

**Steps:**

- [ ] Build `p5-vendored/.agent-library.yml` with `mode: vendored, target: claude, include: [frontend/skills/react-useeffect]`.
- [ ] Confirm `renderGeneratedHeader` in Task 4 already supports `mode: 'vendored'`. If not, extend it now to emit the spec's vendored header text.
- [ ] Implement `src/sync/vendored.ts`:
  ```ts
  // For each PlanFileWrite:
  //   1. Read previous lockfile entry for this target path (may be null on first sync).
  //   2. Compute new target body (header + neutral + adapter, same as generated).
  //   3. If target file does not exist: write it.
  //   4. If target exists and previous lockfile is null: SKIP with reason 'pre-existing file, no lockfile to verify ownership'.
  //   5. If target exists and current-on-disk hash === previous lockfile targetHash: overwrite (sync-controlled update).
  //   6. Else: SKIP and record conflict { path, sourceArtifact, reason: 'locally edited' }.
  // Return { written, skipped[] } and feed both into the new lockfile + summary.
  ```
- [ ] Wire vendored path in `src/commands/sync.ts`: when `manifest.mode === 'vendored'`, call `runVendoredSync`. Vendored mode does NOT delete stale files (it only updates / creates). Document this in code with one comment.
- [ ] Extend `src/sync/summary.ts` to print `Vendored files skipped (locally edited): N` and list each skipped path.
- [ ] Write integration test `tests/integration/sync-vendored.test.ts` covering five cases sequentially:
  1. **First sync** — no `.claude/`, no lockfile. Sync writes the file with vendored header. Lockfile is created.
  2. **Idempotent re-sync** — sync again with no changes. File is unchanged; summary reports zero new writes.
  3. **Source change, clean target** — modify `tests/fixtures/home-min/frontend/skills/react-useeffect/SKILL.md` body. Sync. Target file is updated; lockfile target hash advances. (Restore source after the test in `afterEach`.)
  4. **Locally edited target** — append `LOCAL EDIT` to the target file. Modify the source again. Sync. Target file STILL contains `LOCAL EDIT`; stderr or summary mentions the skip and names `frontend/skills/react-useeffect`. Exit code 0 (skip is a warning, not an error).
  5. **Pre-existing file with no lockfile** — delete the lockfile but leave the target file in place. Sync. The pre-existing file is skipped with the documented reason; no overwrite.
- [ ] Run: `bun run build && bun test tests/integration/sync-vendored.test.ts` → **Expected: PASS** for all five cases.
- [ ] Commit:
  ```bash
  git add src tests/fixtures/projects/p5-vendored tests/integration/sync-vendored.test.ts
  git commit -m "feat: vendored mode with lockfile-gated updates and local-edit protection"
  ```

---

## Task 9: Project-local `./` paths + bundle expansion in lockfile

**Type:** AFK
**Blocked by:** Task 6 (parallel-safe with Task 7 + 8 if no conflict on `src/sync/plan.ts`; sequence is safer)
**Demoable:** A project manifest with `include: [./product/skills/domain-review, global/skills/writing-plans]` resolves the local skill from `<projectRoot>/.agent-library/product/skills/domain-review/` and the global skill from `home-min`. A project manifest with `include: [global]` records all expanded artifact ids (not just the bundle path) in the lockfile.

**Files:**
- Create: `src/resolve/project.ts`, `tests/integration/sync-project-local.test.ts`, `tests/integration/sync-bundle-expansion.test.ts`, `tests/fixtures/projects/p6-local/.agent-library.yml`, `tests/fixtures/projects/p6-local/.agent-library/product/skills/domain-review/SKILL.md`, `tests/fixtures/projects/p7-bundle/.agent-library.yml`
- Modify: `src/resolve/sources.ts` (handle `./` references via project context), `src/sync/plan.ts` (carry original `include` entries through to lockfile), `src/lockfile/schema.ts` is already shaped for this — just ensure `include` is populated from the manifest, not the expansion

**Steps:**

- [x] Build fixture `p6-local`:
  - `.agent-library.yml`: `include: [./product/skills/domain-review, global/skills/writing-plans]`, `mode: generated`, `target: claude`.
  - `.agent-library/product/skills/domain-review/SKILL.md` with frontmatter `name: domain-review`.
- [x] Build fixture `p7-bundle/.agent-library.yml`: `include: [global]`, `mode: generated`, `target: claude`.
- [x] Implement `src/resolve/project.ts` (`resolveLocalIncludeEntry(projectRoot, entry: './...'): Artifact[]`). Reuses `discoverDomain` semantics but rooted at `<projectRoot>/.agent-library/`.
- [x] Update `src/resolve/sources.ts`: replace the Task 3 placeholder that throws on `./` with a call to `resolveLocalIncludeEntry` when `ctx.projectRoot` is non-null; throw a clear error if `./` is encountered with no project context (e.g., when resolving for the home manifest).
- [x] Update `src/sync/plan.ts` so the `include` field passed to the lockfile is `manifest.include` verbatim (the original entries, including bundle paths and `profile:` refs), while `artifacts[]` is the fully expanded list. This is the spec's requirement: "The lockfile must record the expanded artifact list, not only the bundle path."
- [x] Write integration test `tests/integration/sync-project-local.test.ts`:
  - Sync `p6-local`. Assert both `.claude/skills/domain-review/SKILL.md` and `.claude/skills/writing-plans/SKILL.md` exist with generated headers naming their respective sources (`Source: ./product/skills/domain-review` and `Source: global/skills/writing-plans`).
- [x] Write integration test `tests/integration/sync-bundle-expansion.test.ts`:
  - Sync `p7-bundle`. Read the lockfile. Assert `lockfile.include === ['global']` AND `lockfile.artifacts.map(a => a.id).sort()` equals the full expansion `['global/agents/security-reviewer', 'global/commands/review-pr', 'global/skills/writing-plans']`.
- [x] Run: `bun run build && bun test tests/integration/sync-project-local.test.ts tests/integration/sync-bundle-expansion.test.ts` → **Expected: PASS**.
- [ ] Commit:
  ```bash
  git add src tests/fixtures/projects/p6-local tests/fixtures/projects/p7-bundle tests/integration/sync-project-local.test.ts tests/integration/sync-bundle-expansion.test.ts
  git commit -m "feat: project-local includes and full bundle expansion in lockfile"
  ```

---

## Task 10: `init` command + `--dry-run` flag + summary polish

**Type:** AFK
**Blocked by:** Task 7, Task 8
**Demoable:**
- `agent-library init <path>` prompts for manifest choices, creates `.agent-library.yml` at that path, and refuses to overwrite an existing one (exit 1).
- `agent-library sync --dry-run <projectPath>` prints the would-write / would-delete plan without touching disk and without writing the lockfile.
- The success summary printed by `sync` matches the format in the spec exactly.

**Files:**
- Create: `src/commands/init.ts`, `tests/integration/init.test.ts`, `tests/integration/dry-run.test.ts`
- Modify: `src/commands/sync.ts` (accept `--dry-run`), `src/sync/generated.ts` and `src/sync/vendored.ts` (no-op writes when dry-run), `src/sync/summary.ts` (dry-run header), `src/cli.ts` (register `init`)

**Steps:**

- [x] Implement `src/commands/init.ts`:
  - Commander positional `path` (defaults to cwd).
  - Use `@clack/prompts` to ask for `mode`, `target`, and `include` entries.
  - If `<path>/.agent-library.yml` exists, print `manifest already exists at <path>/.agent-library.yml` to stderr and exit 1.
  - Otherwise write a manifest from the prompt answers. The default prompt values should produce:
    ```yaml
    version: 1
    mode: generated
    target: both
    include:
      - profile:universal
    ```
- [x] Register `init` in `src/cli.ts`.
- [x] Write integration test `tests/integration/init.test.ts`:
  1. Run init in a temp directory with prompt input supplied through stdin. Assert `.agent-library.yml` exists and parses through `ManifestSchema`.
  2. Run init again in the same directory. Assert exit 1 and stderr names the existing manifest path.
- [x] Run: `bun run build && bun test tests/integration/init.test.ts` → **Expected: PASS**.
- [x] Add a `--dry-run` boolean flag to the sync command via commander options. Plumb a `dryRun` boolean into `runGeneratedSync` and `runVendoredSync`. When `true`:
  - Skip every file write.
  - Skip lockfile write.
  - Skip cleanup deletes.
  - Print the plan with each prospective write/delete prefixed by `[dry-run] `.
  - Summary header prints `Dry run — no files were written.` before the spec summary.
- [x] Write integration test `tests/integration/dry-run.test.ts`:
  1. On a fresh `p2-mixed` (no `.agents/`, no `.claude/`, no lockfile), run sync with `--dry-run`.
  2. Assert exit 0; stdout contains `[dry-run]` for every prospective target file (six lines for three artifacts × two targets).
  3. Assert no `.agents/`, `.claude/`, or `.agent-library.lock` was created.
  4. Run sync without `--dry-run`; remove one include from the manifest; run sync again with `--dry-run`; assert stdout contains `[dry-run] would remove` for the stale paths but the files still exist on disk.
- [x] Run: `bun run build && bun test tests/integration/dry-run.test.ts` → **Expected: PASS**.
- [x] Final summary check: snapshot test the format of the `agent-library sync` summary output for `p2-mixed` and assert it matches the spec example line-for-line (Root, Mode, Target, Skills, Commands, Agents, Removed stale generated files, Lockfile).
- [x] Run the full suite: `bun run typecheck && bun run build && bun test` → **Expected: PASS** for every test in tasks 1–10.
- [ ] Commit:
  ```bash
  git add src tests/integration/init.test.ts tests/integration/dry-run.test.ts
  git commit -m "feat: init command, --dry-run flag, and final summary format"
  ```

---

## Post-implementation checks

After Task 10 lands:

- [ ] `bun run typecheck && bun run build && bun test` is green from a clean checkout.
- [ ] `./bin/agent-library --help` lists `validate`, `list`, `sync`, `init`.
- [ ] Manually run against the real `~/.agent-library` once the canonical asset library is populated (out of scope here — covered by the spec's "First Migration Strategy").
- [ ] The compiled `bin/agent-library` works when symlinked into a directory on `$PATH`; one manual check against a throwaway project confirms.

## Explicitly out of scope

- Migration of any existing `.agents/` or `.claude/` content.
- Nested profiles (rejected per spec § Profiles).
- Aliasing for collision resolution (rejected per spec § Collision Rules).
- Auto-managed `.gitignore` rules — documented only, per spec open question.
- JSON output mode for `list` — not in the spec; defer to a follow-up.
