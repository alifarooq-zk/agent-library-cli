import { z } from "zod";

export const LockfileAdapterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("applied"),
    source: z.string(),
    hash: z.string(),
  }),
]);

export const LockfileSchema = z.object({
  version: z.literal(2),
  cliVersion: z.string(),
  mode: z.enum(["generated", "vendored"]),
  target: z.enum(["codex", "claude", "both"]),
  syncedAt: z.iso.datetime({
    message: "syncedAt must be an ISO 8601 datetime string",
  }),
  include: z.array(z.string()), // original manifest entries
  artifacts: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["skill", "command", "agent"]),
      files: z.array(
        z.object({
          source: z.string(), // path relative to libraryRoot
          sourceHash: z
            .string()
            .regex(
              /^[0-9a-f]{64}$/,
              "sourceHash must be a 64-character lowercase hex SHA-256 digest",
            ),
          targets: z.array(
            z.object({
              path: z.string(), // path relative to projectRoot
              targetHash: z
                .string()
                .regex(
                  /^[0-9a-f]{64}$/,
                  "targetHash must be a 64-character lowercase hex SHA-256 digest",
                ),
              adapter: LockfileAdapterSchema,
            }),
          ),
        }),
      ),
    }),
  ),
});

export type Lockfile = z.infer<typeof LockfileSchema>;
