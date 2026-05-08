import { Command } from "commander";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import { cancel, intro, isCancel, outro, text } from "@clack/prompts";
import type { Manifest } from "../manifest/schema.ts";
import {
  ResultKit,
  type Result,
  type TypedErrorUnion,
} from "../util/result-kit/index.ts";

type InitMode = Manifest["mode"];
type InitTarget = Manifest["target"];
type InitError = TypedErrorUnion<
  | "init_manifest_exists"
  | "init_invalid_mode"
  | "init_invalid_target"
  | "init_empty_include"
  | "init_canceled"
  | "init_write_error"
>;

export const initCommand = new Command("init")
  .description("Create a .agent-library.yml manifest")
  .argument("[path]", "path where .agent-library.yml should be created", ".")
  .action(async (projectRoot: string) => {
    const absProjectRoot = resolve(projectRoot);
    const manifestPath = join(absProjectRoot, ".agent-library.yml");

    const exists = await Bun.file(manifestPath).exists();
    if (exists) {
      exitWithError({
        type: "init_manifest_exists",
        message: `manifest already exists at ${manifestPath}`,
      });
    }

    if (!process.stdin.isTTY) {
      const manifestResult = await manifestFromStdinDefaults();
      if (!manifestResult.ok) exitWithError(manifestResult.error);

      const writeResult = await writeManifest(manifestPath, manifestResult.value);
      if (!writeResult.ok) exitWithError(writeResult.error);
      process.stdout.write(`created ${manifestPath}\n`);
      return;
    }

    intro("agent-library init");

    const mode = await promptMode();
    if (!mode.ok) exitWithError(mode.error);

    const target = await promptTarget();
    if (!target.ok) exitWithError(target.error);

    const include = await promptInclude();
    if (!include.ok) exitWithError(include.error);

    const manifest: Manifest = {
      version: 1,
      mode: mode.value,
      target: target.value,
      include: include.value,
    };

    const writeResult = await writeManifest(manifestPath, manifest);
    if (!writeResult.ok) exitWithError(writeResult.error);
    outro(`created ${manifestPath}`);
  });

async function manifestFromStdinDefaults(): Promise<Result<Manifest, InitError>> {
  const raw = await new Response(Bun.stdin.stream()).text();
  const lines = raw.split(/\r?\n/);
  const mode = valueOrDefault(lines[0], "generated");
  const target = valueOrDefault(lines[1], "both");
  const includeInput = valueOrDefault(lines[2], "profile:universal");

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

  return ResultKit.success({
    version: 1,
    mode,
    target,
    include,
  });
}

function valueOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallback;
}

async function promptMode(): Promise<Result<InitMode, InitError>> {
  const value = await text({
    message: "Mode",
    defaultValue: "generated",
    placeholder: "generated",
    validate: (input) =>
      input === "generated" || input === "vendored"
        ? undefined
        : "mode must be generated or vendored",
  });

  if (isCancel(value)) {
    cancel("init canceled");
    return ResultKit.failure({
      type: "init_canceled" as const,
      message: "init canceled",
    });
  }

  return ResultKit.success(value as InitMode);
}

async function promptTarget(): Promise<Result<InitTarget, InitError>> {
  const value = await text({
    message: "Target",
    defaultValue: "both",
    placeholder: "both",
    validate: (input) =>
      input === "codex" || input === "claude" || input === "both"
        ? undefined
        : "target must be codex, claude, or both",
  });

  if (isCancel(value)) {
    cancel("init canceled");
    return ResultKit.failure({
      type: "init_canceled" as const,
      message: "init canceled",
    });
  }

  return ResultKit.success(value as InitTarget);
}

async function promptInclude(): Promise<Result<string[], InitError>> {
  const value = await text({
    message: "Include entries",
    defaultValue: "profile:universal",
    placeholder: "profile:universal",
    validate: (input) =>
      parseInclude(input).length > 0
        ? undefined
        : "include must have at least one entry",
  });

  if (isCancel(value)) {
    cancel("init canceled");
    return ResultKit.failure({
      type: "init_canceled" as const,
      message: "init canceled",
    });
  }

  return ResultKit.success(parseInclude(value));
}

function parseInclude(input: string | undefined): string[] {
  return (input ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function writeManifest(
  manifestPath: string,
  manifest: Manifest,
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
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
