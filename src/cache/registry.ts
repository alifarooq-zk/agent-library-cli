import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../util/fs.ts";
import {
  ResultKit,
  type Result,
  type TypedError,
} from "../util/result-kit/index.ts";
import { defaultCacheRoot } from "../util/cache.ts";

function defaultRegistryPath(): string {
  return join(defaultCacheRoot(), "projects.json");
}

export interface ProjectEntry {
  readonly path: string;
  readonly repo: string;
  readonly ref: string;
  readonly sha: string;
  readonly lastSyncedAt: string;
}

export interface Registry {
  readonly projects: ProjectEntry[];
}

const ProjectEntrySchema = z.object({
  path: z.string(),
  repo: z.string(),
  ref: z.string(),
  sha: z.string(),
  lastSyncedAt: z.string(),
});

const RegistrySchema = z.object({
  projects: z.array(ProjectEntrySchema),
});

export type RegistryError = TypedError<
  "registry_read_error" | "registry_write_error"
>;

export async function readRegistry(
  registryPath = defaultRegistryPath(),
): Promise<Result<Registry, RegistryError>> {
  const file = Bun.file(registryPath);
  const existsResult = await ResultKit.fromPromise(file.exists(), (cause) => ({
    type: "registry_read_error" as const,
    message: `cannot stat registry at ${registryPath}`,
    cause,
  }));

  if (!existsResult.ok) return existsResult;
  if (!existsResult.value) return ResultKit.success({ projects: [] });

  const textResult = await ResultKit.fromPromise(file.text(), (cause) => ({
    type: "registry_read_error" as const,
    message: `cannot read registry at ${registryPath}`,
    cause,
  }));
  if (!textResult.ok) return textResult;

  const parseResult = ResultKit.fromThrowable(
    (text: string) => JSON.parse(text) as unknown,
    (cause) => ({
      type: "registry_read_error" as const,
      message: `registry at ${registryPath} contains invalid JSON`,
      cause,
    }),
  )(textResult.value);
  if (!parseResult.ok) return parseResult;

  const parsed = parseResult.value;
  const schemaResult = RegistrySchema.safeParse(parsed);
  if (!schemaResult.success) {
    return ResultKit.failure({
      type: "registry_read_error" as const,
      message: `registry at ${registryPath} has invalid structure: entries are malformed`,
    });
  }

  return ResultKit.success(schemaResult.data);
}

export async function upsertProjectEntry(
  registryPath = defaultRegistryPath(),
  entry: ProjectEntry,
): Promise<Result<void, RegistryError>> {
  const readResult = await readRegistry(registryPath);
  if (!readResult.ok) return readResult;

  const projects = readResult.value.projects.filter(
    (p) => p.path !== entry.path,
  );
  projects.push(entry);

  return ResultKit.fromPromise(
    writeFileAtomic(registryPath, JSON.stringify({ projects }, null, 2)),
    (cause) => ({
      type: "registry_write_error" as const,
      message: `cannot write registry at ${registryPath}`,
      cause,
    }),
  );
}
