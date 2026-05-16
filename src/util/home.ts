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
