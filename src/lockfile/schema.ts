import { z } from "zod";

export const LockfileSchema = z.object({
  version: z.literal(1),
  cliVersion: z.string(),
  mode: z.enum(["generated", "vendored"]),
  target: z.enum(["codex", "claude", "both"]),
  syncedAt: z.string(), // ISO 8601
  include: z.array(z.string()), // original manifest entries
  artifacts: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["skill", "command", "agent"]),
      files: z.array(
        z.object({
          source: z.string(), // path relative to libraryRoot
          sourceHash: z.string(), // sha256 hex
          targets: z.array(
            z.object({
              path: z.string(), // path relative to projectRoot
              targetHash: z.string(),
              adapterSource: z.string().nullable(),
              adapterHash: z.string().nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type Lockfile = z.infer<typeof LockfileSchema>;
