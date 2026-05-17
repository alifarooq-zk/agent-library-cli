import { Command } from "commander";
import { dirname, join, resolve } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import { stringify } from "yaml";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  groupMultiselect,
  note,
  outro,
  select,
  text,
} from "@clack/prompts";
import type { Manifest, ManifestInput } from "../manifest/schema.ts";
import {
  GLOBAL_RESERVED_MESSAGE,
  includeReferencesGlobal,
  validateResolvedArtifactsScope,
} from "../manifest/validate.ts";
import {
  ResultKit,
  type Result,
  type TypedErrorUnion,
} from "../util/result-kit/index.ts";
import { resolveHomePaths } from "../util/home.ts";
import { discoverDomains, discoverDomain } from "../artifact/discover.ts";
import { resolveIncludes } from "../resolve/sources.ts";
import { resolveSource, type SourceResolveError } from "../resolve/source.ts";
import type { ManifestSource } from "../manifest/schema.ts";
import { writeLockfile } from "../lockfile/write.ts";
// @ts-ignore — resolveJsonModule + allowImportingTsExtensions handles this
import pkg from "../../package.json";

type InitMode = Manifest["mode"];
type InitTarget = Manifest["target"];
type InitScope = Manifest["scope"];
type InitError = TypedErrorUnion<
  | "init_manifest_exists"
  | "init_invalid_mode"
  | "init_invalid_target"
  | "init_invalid_include"
  | "init_invalid_source"
  | "init_source_required"
  | "init_empty_include"
  | "init_canceled"
  | "init_write_error"
>;

interface InitOptions {
  global?: boolean;
  home?: string;
  repo?: string;
  ref?: string;
}

export const initCommand = new Command("init")
  .description("Create a .agent-library.yml manifest")
  .argument("[path]", "path where .agent-library.yml should be created", ".")
  .option(
    "--global",
    "create a home-scoped manifest for a home AI-config directory (e.g. ~/.copilot, ~/.agents); allows global-domain includes that are otherwise reserved and forbidden in project manifests",
  )
  .option(
    "--home <path>",
    "override the library tree for project init, or the home base for --global init",
  )
  .option("--repo <owner/name>", "GitHub repository to record as source")
  .option("--ref <ref>", "Git ref to record as source")
  .action(async (projectRoot: string, opts: InitOptions) => {
    const scope: InitScope = opts.global === true ? "home" : "project";
    const homePaths =
      scope === "home"
        ? resolveHomePaths(process.platform, process.env, opts.home)
        : null;
    const absProjectRoot = resolve(projectRoot);
    const manifestPath =
      scope === "home"
        ? (homePaths?.manifest ?? join(absProjectRoot, ".agent-library.yml"))
        : join(absProjectRoot, ".agent-library.yml");
    const initProjectRoot =
      scope === "home" && homePaths
        ? dirname(homePaths.manifest)
        : absProjectRoot;

    const exists = await Bun.file(manifestPath).exists();
    if (exists) {
      if (!process.stdin.isTTY) {
        exitWithError({
          type: "init_manifest_exists",
          message: `manifest already exists at ${manifestPath}`,
        });
      }
    }

    if (!process.stdin.isTTY) {
      const source = sourceFromOptions(opts);
      if (!source.ok) exitWithError(source.error);

      const homeRootResult = await materializeInitHomeRoot(
        source.value,
        opts,
        scope,
        manifestPath,
      );
      if (!homeRootResult.ok && !isSourceNetworkError(homeRootResult.error)) {
        exitWithTypedError(homeRootResult.error);
      }
      if (!homeRootResult.ok) {
        process.stderr.write(
          "warning: can't reach github.com; using typed include entries without picker validation\n",
        );
      }
      const homeRoot = homeRootResult.ok ? homeRootResult.value : null;
      const manifestResult = await manifestFromStdinDefaults(
        homeRoot,
        initProjectRoot,
        scope,
        source.value,
      );
      if (!manifestResult.ok) exitWithError(manifestResult.error);

      const writeResult = await writeManifest(
        manifestPath,
        manifestResult.value,
      );
      if (!writeResult.ok) exitWithError(writeResult.error);
      process.stdout.write(`created ${manifestPath}\n`);
      return;
    }

    intro("agent-library init");

    if (exists) {
      const shouldOverwrite = await confirm({
        message: `manifest already exists at ${manifestPath}; overwrite?`,
        initialValue: false,
      });
      if (isCancel(shouldOverwrite) || shouldOverwrite !== true) {
        cancel("init canceled");
        exitWithError({
          type: "init_manifest_exists",
          message: `manifest already exists at ${manifestPath}`,
        });
      }
    }

    if (scope === "home") {
      note(
        'This manifest will be scoped to "home", which allows global-domain\n' +
          "includes reserved for home AI-config directories (e.g. ~/.copilot,\n" +
          "~/.agents). Do not use --global for ordinary project manifests.",
        "home-scoped manifest",
      );
    }

    const source = await promptSource(opts);
    if (!source.ok) exitWithError(source.error);

    const homeRootResult = await materializeInitHomeRoot(
      source.value,
      opts,
      scope,
      manifestPath,
    );
    const homeRoot = homeRootResult.ok ? homeRootResult.value : null;
    if (!homeRootResult.ok && isSourceNetworkError(homeRootResult.error)) {
      note(
        "can't reach github.com; type include entries as free text, or re-run with network access for the picker.",
        "source unavailable",
      );
    } else if (!homeRootResult.ok) {
      exitWithTypedError(homeRootResult.error);
    }

    const mode = await promptMode();
    if (!mode.ok) exitWithError(mode.error);

    const target = await promptTarget();
    if (!target.ok) exitWithError(target.error);

    const include = await promptInclude(
      homeRoot,
      initProjectRoot,
      scope,
      source.value,
    );
    if (!include.ok) exitWithError(include.error);

    const manifest: ManifestInput = {
      version: 1,
      ...(scope === "home" ? { scope } : {}),
      mode: mode.value,
      target: target.value,
      include: include.value,
      source: source.value,
    };

    const writeResult = await writeManifest(manifestPath, manifest);
    if (!writeResult.ok) exitWithError(writeResult.error);
    outro(`created ${manifestPath}`);
  });

async function manifestFromStdinDefaults(
  homeRoot: string | null,
  projectRoot: string,
  scope: InitScope,
  source: ManifestSource,
): Promise<Result<ManifestInput, InitError>> {
  const raw = await new Response(Bun.stdin.stream()).text();
  const lines = raw.split(/\r?\n/);
  const mode = valueOrDefault(lines[0], "generated");
  const target = valueOrDefault(lines[1], "both");
  const includeInput = valueOrDefault(
    lines[2],
    scope === "home"
      ? homeRoot
        ? await defaultHomeInclude(homeRoot)
        : "profile:universal"
      : homeRoot
        ? await defaultProjectInclude(homeRoot)
        : "frontend",
  );

  if (mode !== "generated" && mode !== "vendored") {
    return ResultKit.failure({
      type: "init_invalid_mode" as const,
      message: "mode must be generated or vendored",
    });
  }

  if (target !== "codex" && target !== "claude" && target !== "both") {
    return ResultKit.failure({
      type: "init_invalid_target" as const,
      message: "target must be codex, claude, or both",
    });
  }

  const include = parseInclude(includeInput);
  if (include.length === 0) {
    return ResultKit.failure({
      type: "init_empty_include" as const,
      message: "include must have at least one entry",
    });
  }

  if (
    scope !== "home" &&
    include.some((entry) => includeReferencesGlobal(entry))
  ) {
    return ResultKit.failure({
      type: "init_invalid_include" as const,
      message: GLOBAL_RESERVED_MESSAGE,
    });
  }

  if (homeRoot) {
    const resolveCtx =
      scope === "home"
        ? ({ kind: "home", homeRoot } as const)
        : ({ kind: "project", homeRoot, projectRoot } as const);
    const resolved = await resolveIncludes(include, resolveCtx);
    if (!resolved.ok) {
      return ResultKit.failure({
        type: "init_invalid_include" as const,
        message: resolved.error.message,
      });
    }

    const scopeIssues = validateResolvedArtifactsScope(
      {
        version: 1,
        scope,
        mode: mode as InitMode,
        target: target as InitTarget,
        include,
        source,
      },
      resolved.value,
    );
    if (scopeIssues.length > 0) {
      return ResultKit.failure({
        type: "init_invalid_include" as const,
        message: scopeIssues.map((i) => i.message).join("\n"),
      });
    }
  }

  return ResultKit.success({
    version: 1,
    ...(scope === "home" ? { scope } : {}),
    mode,
    target,
    include,
    source,
  });
}

async function defaultProjectInclude(homeRoot: string): Promise<string> {
  // Fall back to "profile:universal" rather than "" so that when all domains
  // are global, the user sees GLOBAL_RESERVED_MESSAGE instead of the
  // misleading "include must have at least one entry" error.
  return (
    discoverDomains(homeRoot).find((domain) => domain !== "global") ??
    "profile:universal"
  );
}

async function defaultHomeInclude(homeRoot: string): Promise<string> {
  if (existsSync(join(homeRoot, "profiles", "universal.yml"))) {
    return "profile:universal";
  }
  if (discoverDomains(homeRoot).includes("global")) {
    return "global";
  }
  return (await defaultProjectInclude(homeRoot)) || "profile:universal";
}

function valueOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallback;
}

async function promptMode(): Promise<Result<InitMode, InitError>> {
  const value = await select<InitMode>({
    message: "Mode",
    options: [
      {
        value: "generated",
        label: "generated",
        hint: "agent-library owns files and may overwrite them",
      },
      {
        value: "vendored",
        label: "vendored",
        hint: "files are copied once and owned by the project",
      },
    ],
  });

  if (isCancel(value)) {
    cancel("init canceled");
    return ResultKit.failure({
      type: "init_canceled" as const,
      message: "init canceled",
    });
  }

  return ResultKit.success(value);
}

async function promptTarget(): Promise<Result<InitTarget, InitError>> {
  const value = await select<InitTarget>({
    message: "Target",
    options: [
      { value: "both", label: "both", hint: "write to .agents and .claude" },
      { value: "claude", label: "claude", hint: "write to .claude only" },
      { value: "codex", label: "codex", hint: "write to .agents only" },
    ],
  });

  if (isCancel(value)) {
    cancel("init canceled");
    return ResultKit.failure({
      type: "init_canceled" as const,
      message: "init canceled",
    });
  }

  return ResultKit.success(value);
}

async function promptSource(
  opts: InitOptions,
): Promise<Result<ManifestSource, InitError>> {
  let repo = opts.repo?.trim() ?? "";
  while (!repo) {
    const value = await promptRepo();
    if (!value.ok) return value;
    repo = value.value;
  }

  while (!validateRepoFormat(repo)) {
    if (!process.stdin.isTTY) {
      return ResultKit.failure({
        type: "init_invalid_source" as const,
        message: "repo must be in owner/name format",
      });
    }
    const value = await promptRepo("repo must be in owner/name format");
    if (!value.ok) return value;
    repo = value.value;
  }

  let ref = opts.ref?.trim() ?? "";
  while (!ref) {
    const value = await promptRef();
    if (!value.ok) return value;
    ref = value.value;
  }

  return ResultKit.success({ type: "github", repo, ref });
}

async function promptRepo(error?: string): Promise<Result<string, InitError>> {
  if (error) note(error, "invalid source");

  const value = await text({
    message: "GitHub repository",
    placeholder: "owner/name",
    validate: (input) => {
      const repo = String(input ?? "").trim();
      if (repo.length === 0) return "repo is required";
      return validateRepoFormat(repo)
        ? undefined
        : "repo must be in owner/name format";
    },
  });

  if (isCancel(value)) {
    cancel("init canceled");
    return ResultKit.failure({
      type: "init_canceled" as const,
      message: "init canceled",
    });
  }

  return ResultKit.success(String(value).trim());
}

async function promptRef(): Promise<Result<string, InitError>> {
  const value = await text({
    message: "Git ref",
    placeholder: "main",
    defaultValue: "main",
    validate: (input) =>
      String(input ?? "").trim().length > 0 ? undefined : "ref is required",
  });

  if (isCancel(value)) {
    cancel("init canceled");
    return ResultKit.failure({
      type: "init_canceled" as const,
      message: "init canceled",
    });
  }

  return ResultKit.success(String(value).trim());
}

function sourceFromOptions(
  opts: InitOptions,
): Result<ManifestSource, InitError> {
  const repo = opts.repo?.trim();
  const ref = opts.ref?.trim();
  if (!repo || !ref) {
    return ResultKit.failure({
      type: "init_source_required" as const,
      message: "--repo and --ref are required in non-interactive mode",
    });
  }
  if (!validateRepoFormat(repo)) {
    return ResultKit.failure({
      type: "init_invalid_source" as const,
      message: "repo must be in owner/name format",
    });
  }
  return ResultKit.success({ type: "github", repo, ref });
}

function validateRepoFormat(repo: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo);
}

async function materializeInitHomeRoot(
  source: ManifestSource,
  opts: InitOptions,
  scope: InitScope,
  manifestPath: string,
): Promise<Result<string, InitError | SourceResolveError>> {
  if (scope !== "home" && opts.home) {
    return ResultKit.success(resolve(opts.home));
  }

  const lockfilePath = join(dirname(manifestPath), ".agent-library.init.lock");
  const sourceResult = await resolveSource(source, lockfilePath, {
    update: false,
  });
  if (!sourceResult.ok) return sourceResult;

  // Persist the resolved source to the init lockfile so subsequent init runs
  // against the same repo/ref use the cached tree instead of re-fetching.
  const writeResult = await writeLockfile(lockfilePath, {
    version: 1,
    cliVersion: (pkg as { version: string }).version,
    mode: "generated",
    target: "both",
    syncedAt: new Date().toISOString(),
    source: sourceResult.value.source,
    include: [],
    artifacts: [],
  });
  if (!writeResult.ok) {
    return ResultKit.failure({
      type: "init_write_error" as const,
      message: `cannot write init lockfile at ${lockfilePath}`,
      cause: writeResult.error,
    });
  }

  return ResultKit.success(sourceResult.value.homeRoot);
}

function isSourceNetworkError(error: InitError | SourceResolveError): boolean {
  return (
    error.type === "git_fetch_error" ||
    error.type === "git_auth_failure" ||
    error.type === "git_repo_not_found"
  );
}

async function promptInclude(
  homeRoot: string | null,
  projectRoot: string,
  scope: InitScope,
  source: ManifestSource,
): Promise<Result<string[], InitError>> {
  const groups = homeRoot
    ? await buildIncludeGroups(homeRoot, {
        allowGlobal: scope === "home",
      })
    : {};
  const fallbackInclude = defaultIncludeSelection(groups);
  let selected: string[] = [];

  if (Object.keys(groups).length > 0) {
    const chosen = await groupMultiselect<string>({
      message: "Include entries (Space to select, Enter to continue)",
      options: groups,
      required: false,
      selectableGroups: false,
    });

    if (isCancel(chosen)) {
      cancel("init canceled");
      return ResultKit.failure({
        type: "init_canceled" as const,
        message: "init canceled",
      });
    }

    selected = chosen;
  }

  const hasSelection = selected.length > 0;
  const extra = await text({
    message: "Custom entries (leave blank to skip)",
    placeholder: hasSelection ? "" : "profile:universal",
    defaultValue: "",
    validate: (input) => {
      const all = [...selected, ...parseInclude(input ?? "")];
      return all.length > 0 || fallbackInclude.length > 0
        ? undefined
        : "include must have at least one entry";
    },
  });

  if (isCancel(extra)) {
    cancel("init canceled");
    return ResultKit.failure({
      type: "init_canceled" as const,
      message: "init canceled",
    });
  }

  const parsedExtra = parseInclude(extra as string);
  const all = uniqueIncludes(
    selected.length === 0 && parsedExtra.length === 0
      ? fallbackInclude
      : [...selected, ...parsedExtra],
  );
  if (all.length === 0) {
    return ResultKit.failure({
      type: "init_empty_include" as const,
      message: "include must have at least one entry",
    });
  }

  if (scope !== "home" && all.some((entry) => includeReferencesGlobal(entry))) {
    return ResultKit.failure({
      type: "init_invalid_include" as const,
      message: GLOBAL_RESERVED_MESSAGE,
    });
  }

  if (homeRoot) {
    const resolveCtx =
      scope === "home"
        ? ({ kind: "home", homeRoot } as const)
        : ({ kind: "project", homeRoot, projectRoot } as const);
    const resolved = await resolveIncludes(all, resolveCtx);
    if (!resolved.ok) {
      return ResultKit.failure({
        type: "init_invalid_include" as const,
        message: resolved.error.message,
      });
    }

    const scopeIssues = validateResolvedArtifactsScope(
      {
        version: 1,
        scope,
        mode: "generated",
        target: "both",
        include: all,
        source,
      },
      resolved.value,
    );
    if (scopeIssues.length > 0) {
      return ResultKit.failure({
        type: "init_invalid_include" as const,
        message: scopeIssues.map((i) => i.message).join("\n"),
      });
    }
  }

  return ResultKit.success(all);
}

function defaultIncludeSelection(
  groups: Record<
    string,
    Array<{ value: string; label: string; hint?: string }>
  >,
): string[] {
  const profileOptions = groups["Profiles"] ?? [];
  if (profileOptions.some((option) => option.value === "profile:universal")) {
    return ["profile:universal"];
  }
  if (groups["global"]?.some((option) => option.value === "global")) {
    return ["global"];
  }
  for (const options of Object.values(groups)) {
    const first = options[0]?.value;
    if (first) return [first];
  }
  return [];
}

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
  if (!resolved.ok) {
    // Only suppress global-domain scope violations (which we handle by hiding
    // the profile). Any other error means the profile itself is broken — show
    // it so downstream validation surfaces the real error with full context.
    if (resolved.error.type === "profile_not_found") return false;
    return true;
  }
  return resolved.value.every((artifact) => artifact.domain !== "global");
}

export async function buildIncludeGroups(
  homeRoot: string,
  options: { allowGlobal: boolean } = { allowGlobal: true },
): Promise<
  Record<string, Array<{ value: string; label: string; hint?: string }>>
> {
  const groups: Record<
    string,
    Array<{ value: string; label: string; hint?: string }>
  > = {};

  const profilesDir = join(homeRoot, "profiles");
  if (existsSync(profilesDir)) {
    const profiles = readdirSync(profilesDir)
      .sort()
      .filter((entry) => {
        try {
          return (
            statSync(join(profilesDir, entry)).isFile() &&
            entry.endsWith(".yml")
          );
        } catch {
          return false;
        }
      });
    if (profiles.length > 0) {
      const profileOptions: Array<{ value: string; label: string }> = [];
      for (const entry of profiles) {
        const name = entry.slice(0, -4);
        if (
          !(await profileAllowedForScope(homeRoot, name, options.allowGlobal))
        ) {
          continue;
        }
        profileOptions.push({
          value: `profile:${name}`,
          label: `profile:${name}`,
        });
      }
      if (profileOptions.length > 0) {
        groups["Profiles"] = profileOptions;
      }
    }
  }

  for (const domain of discoverDomains(homeRoot)) {
    if (!options.allowGlobal && domain === "global") continue;
    const artifacts = discoverDomain(homeRoot, domain);
    const entries: Array<{ value: string; label: string; hint?: string }> = [];

    entries.push({ value: domain, label: domain, hint: "entire domain" });

    const byCategory = new Map<string, typeof artifacts>();
    for (const art of artifacts) {
      const cat = art.id.split("/")[1];
      let bucket = byCategory.get(cat);
      if (!bucket) {
        bucket = [];
        byCategory.set(cat, bucket);
      }
      bucket.push(art);
    }

    for (const [cat, arts] of [...byCategory.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const kind = arts[0].kind;
      entries.push({
        value: `${domain}/${cat}`,
        label: `${domain}/${cat}`,
        hint: `${arts.length} ${kind}${arts.length !== 1 ? "s" : ""}`,
      });
      for (const art of arts) {
        entries.push({ value: art.id, label: art.id });
      }
    }

    groups[domain] = entries;
  }

  return groups;
}

function parseInclude(input: string | undefined): string[] {
  return (input ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueIncludes(entries: string[]): string[] {
  return [...new Set(entries)];
}

function writeManifest(
  manifestPath: string,
  manifest: ManifestInput,
): Promise<Result<number, InitError>> {
  return ResultKit.fromPromise(
    Bun.write(manifestPath, stringify(manifest, { lineWidth: 0 })),
    (cause) => ({
      type: "init_write_error" as const,
      message: `cannot write manifest at ${manifestPath}`,
      cause,
    }),
  );
}

function exitWithError(error: InitError): never {
  exitWithTypedError(error);
}

function exitWithTypedError(error: InitError | SourceResolveError): never {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
