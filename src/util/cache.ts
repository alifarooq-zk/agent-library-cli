import { join } from "node:path";
import { homedir } from "node:os";

export function defaultCacheRoot(): string {
  return (
    process.env.AGENT_LIBRARY_CACHE_DIR ??
    join(homedir(), ".cache", "agent-library")
  );
}
