import { z } from "zod";

export const ManifestSchema = z.object({
  version: z.literal(1, { error: "version is required and must be 1" }),
  mode: z.enum(["generated", "vendored"]),
  target: z.enum(["codex", "claude", "both"]),
  include: z
    .array(z.string())
    .min(1, { error: "include must have at least one entry" }),
});

export type Manifest = z.infer<typeof ManifestSchema>;
