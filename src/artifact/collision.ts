export interface CollisionIssue {
  targetPath: string;
  sources: string[];
  message: string;
}

/**
 * Detect target path collisions across a set of planned writes.
 * Returns one issue per target path that is claimed by more than one source artifact.
 */
export function detectCollisions(
  writes: Array<{ artifactId: string; targetPath: string }>,
): CollisionIssue[] {
  const byTarget = new Map<string, string[]>();

  for (const w of writes) {
    const existing = byTarget.get(w.targetPath) ?? [];
    existing.push(w.artifactId);
    byTarget.set(w.targetPath, existing);
  }

  const issues: CollisionIssue[] = [];

  for (const [targetPath, sources] of byTarget) {
    if (sources.length > 1) {
      issues.push({
        targetPath,
        sources,
        message: `Target path '${targetPath}' is claimed by multiple sources: ${sources.join(", ")}`,
      });
    }
  }

  return issues;
}
