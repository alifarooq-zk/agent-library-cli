import { z } from "zod";

export const ManifestSourceSchema = z.object({
  type: z.literal("github"),
  repo: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, "repo must be in org/name format"),
  ref: z.string().min(1, "ref is required"),
});

export const ManifestSchema = z.object({
  version: z.literal(1, { error: "version is required and must be 1" }),
  scope: z.enum(["home", "project"]).default("project"),
  mode: z.enum(["generated", "vendored"]),
  target: z.enum(["codex", "claude", "both"]),
  include: z
    .array(z.string())
    .min(1, { error: "include must have at least one entry" }),
  source: ManifestSourceSchema.optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestInput = z.input<typeof ManifestSchema>;
export type ManifestSource = z.infer<typeof ManifestSourceSchema>;
