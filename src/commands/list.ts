import { Command } from "commander";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { discoverDomain, discoverDomains } from "../artifact/discover.ts";
import type { ArtifactKind } from "../artifact/types.ts";
import { loadManifest } from "../manifest/load.ts";
import { ManifestSchema } from "../manifest/schema.ts";
import { readLockfile } from "../lockfile/read.ts";
import { resolveSource } from "../resolve/source.ts";

export const listCommand = new Command("list")
  .description("List domains, profiles, or artifacts from the library source")
  .helpCommand(false);

listCommand
  .command("domains")
  .description("List all domains in the library source")
  .option("--home <path>", "use a pre-materialised library tree")
  .action(async (opts: { home?: string }) => {
    const homeRoot = await resolveListHomeRoot(opts.home);
    const domains = discoverDomains(homeRoot);
    for (const d of domains) process.stdout.write(`${d}\n`);
  });

listCommand
  .command("profiles")
  .description("List all profiles in the library source")
  .option("--home <path>", "use a pre-materialised library tree")
  .action(async (opts: { home?: string }) => {
    const homeRoot = await resolveListHomeRoot(opts.home);
    const profilesDir = join(homeRoot, "profiles");
    if (!existsSync(profilesDir)) {
      process.stderr.write(`no profiles directory found at ${profilesDir}\n`);
      return;
    }
    const profiles = readdirSync(profilesDir)
      .sort()
      .filter(
        (entry) =>
          statSync(join(profilesDir, entry)).isFile() && entry.endsWith(".yml"),
      );
    if (profiles.length === 0) {
      process.stderr.write(`no profiles found in ${profilesDir}\n`);
      return;
    }
    for (const entry of profiles) {
      process.stdout.write(`${entry.slice(0, -4)}\n`);
    }
  });

listCommand
  .command("artifacts")
  .description("List all artifacts in the library source")
  .option("--home <path>", "use a pre-materialised library tree")
  .option("--domain <domain>", "filter to a specific domain")
  .option("--type <type>", "filter by artifact kind: skill, command, or agent")
  .action(async (opts: { home?: string; domain?: string; type?: string }) => {
    const homeRoot = await resolveListHomeRoot(opts.home);
    const domains = opts.domain ? [opts.domain] : discoverDomains(homeRoot);
    const kindFilter = opts.type as ArtifactKind | undefined;

    for (const domain of domains) {
      const artifacts = discoverDomain(homeRoot, domain);
      for (const artifact of artifacts) {
        if (kindFilter && artifact.kind !== kindFilter) continue;
        process.stdout.write(`${artifact.id}\n`);
      }
    }
  });

async function resolveListHomeRoot(homeOverride?: string): Promise<string> {
  if (homeOverride) return homeOverride;

  const projectRoot = process.cwd();
  const manifestPath = join(projectRoot, ".agent-library.yml");
  if (!existsSync(manifestPath)) {
    process.stderr.write(
      "error: no manifest in current directory; pass `--home <path>` or run from a project root\n",
    );
    process.exit(1);
  }

  const loaded = await loadManifest(manifestPath);
  if (!loaded.ok) {
    process.stderr.write(`error: cannot read ${manifestPath}\n`);
    process.exit(1);
  }

  const schemaResult = ManifestSchema.safeParse(loaded.value);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      process.stderr.write(`${issue.path.join(".")}: ${issue.message}\n`);
    }
    process.exit(1);
  }
  if (!schemaResult.data.source) {
    process.stderr.write(
      "source: source is required; add a source block with type, repo, and ref\n",
    );
    process.exit(1);
  }

  const lockfilePath = join(projectRoot, ".agent-library.lock");
  const lockResult = await readLockfile(lockfilePath);
  if (!lockResult.ok) {
    process.stderr.write(`error: ${lockResult.error.message}\n`);
    process.exit(1);
  }

  if (!lockResult.value?.source?.sha) {
    process.stderr.write(
      "warning: no pinned SHA in lockfile; fetching HEAD from GitHub — run `sync` to pin a SHA\n",
    );
  }

  const sourceResult = await resolveSource(
    schemaResult.data.source,
    lockfilePath,
    {
      update: false,
    },
  );
  if (!sourceResult.ok) {
    if (sourceResult.error.type === "git_sha_not_cached") {
      process.stderr.write(
        "error: locked SHA not in cache; run `sync --update`\n",
      );
    } else {
      process.stderr.write(`error: ${sourceResult.error.message}\n`);
    }
    process.exit(1);
  }

  return sourceResult.value.homeRoot;
}
