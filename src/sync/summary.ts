import type { SyncPlan } from "./plan.ts";

export interface SyncSummaryData {
  projectRoot: string;
  mode: "generated" | "vendored";
  target: "codex" | "claude" | "both";
  skills: number;
  commands: number;
  agents: number;
  removedStale: number;
  vendoredSkipped?: { path: string; reason: string }[];
  lockfile: string;
  dryRun?: boolean;
}

/**
 * Print the final sync summary matching the spec format exactly.
 */
export function printSummary(data: SyncSummaryData): void {
  const lines = [
    ...(data.dryRun ? ["Dry run — no files were written."] : []),
    "Agent library sync complete",
    `Root: ${data.projectRoot}`,
    `Mode: ${data.mode}`,
    `Target: ${data.target}`,
    `Skills: ${data.skills}`,
    `Commands: ${data.commands}`,
    `Agents: ${data.agents}`,
    `Removed stale generated files: ${data.removedStale}`,
  ];

  if (data.mode === "vendored") {
    const skipped = data.vendoredSkipped ?? [];
    const locallyEditedCount = skipped.filter(
      (item) => item.reason === "locally edited",
    ).length;
    lines.push(`Vendored files skipped (locally edited): ${locallyEditedCount}`);
    for (const item of skipped) {
      lines.push(`Skipped: ${item.path} (${item.reason})`);
    }
  }

  lines.push(`Lockfile: ${data.lockfile}`);

  process.stdout.write(lines.join("\n") + "\n");
}

/** Count unique artifact ids by kind from a plan. */
export function countByKind(plan: SyncPlan): {
  skills: number;
  commands: number;
  agents: number;
} {
  // Deduplicate by artifactId (same artifact appears once per targetDir)
  const seen = new Map<string, string>();
  for (const w of plan.writes) {
    seen.set(w.artifactId, w.artifactKind);
  }

  let skills = 0;
  let commands = 0;
  let agents = 0;

  for (const kind of seen.values()) {
    if (kind === "skill") skills++;
    else if (kind === "command") commands++;
    else if (kind === "agent") agents++;
  }

  return { skills, commands, agents };
}
