import { Command } from "commander";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveHomeRoot } from "../util/home.ts";
import { discoverDomain, discoverDomains } from "../artifact/discover.ts";
import type { ArtifactKind } from "../artifact/types.ts";

export const listCommand = new Command("list")
  .description("List domains, profiles, or artifacts from the home library")
  .helpCommand(false);

listCommand
  .command("domains")
  .description("List all domains in the home library")
  .option("--home <path>", "override home library root")
  .action((opts: { home?: string }) => {
    const homeRoot = resolveHomeRoot(opts.home);
    const domains = discoverDomains(homeRoot);
    for (const d of domains) process.stdout.write(`${d}\n`);
  });

listCommand
  .command("profiles")
  .description("List all profiles in the home library")
  .option("--home <path>", "override home library root")
  .action((opts: { home?: string }) => {
    const homeRoot = resolveHomeRoot(opts.home);
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
  .description("List all artifacts in the home library")
  .option("--home <path>", "override home library root")
  .option("--domain <domain>", "filter to a specific domain")
  .option("--type <type>", "filter by artifact kind: skill, command, or agent")
  .action((opts: { home?: string; domain?: string; type?: string }) => {
    const homeRoot = resolveHomeRoot(opts.home);
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
