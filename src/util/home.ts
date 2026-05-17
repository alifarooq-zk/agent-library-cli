import { join, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve the home library root from (in priority order):
 *   1. An explicit --home flag value passed as argument
 *   2. The HOME_AGENT_LIBRARY environment variable
 *   3. ~/.agent-library
 */
export function resolveHomeRoot(flagValue?: string): string {
  if (flagValue) return resolve(flagValue);
  if (process.env.HOME_AGENT_LIBRARY) {
    return resolve(process.env.HOME_AGENT_LIBRARY);
  }
  return join(homedir(), ".agent-library");
}

export function resolveHomePaths(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  override?: string,
): {
  manifest: string;
  lockfile: string;
  claude: string;
  agents: string;
} {
  let base: string;
  if (platform === "win32") {
    if (override) base = resolve(override);
    else base = env.USERPROFILE || homedir();

    return {
      manifest: join(base, ".agent-library.yml"),
      lockfile: join(base, ".agent-library.lock"),
      claude: join(base, ".claude"),
      agents: join(base, ".agents"),
    };
  }

  // POSIX-style output for non-win32 platforms
  if (override) base = resolve(override);
  else base = env.HOME || homedir();

  // Normalize backslashes to forward slashes just in case
  const posixBase = base.replace(/\\/g, "/");
  const stripTrailing = posixBase.replace(/\/$/, "");

  return {
    manifest: `${stripTrailing}/.agent-library.yml`,
    lockfile: `${stripTrailing}/.agent-library.lock`,
    claude: `${stripTrailing}/.claude`,
    agents: `${stripTrailing}/.agents`,
  };
}
