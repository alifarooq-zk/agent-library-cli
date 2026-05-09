import type { Brand } from "../artifact/types.ts";
import { isLocalRef, isProfileRef } from "../util/paths.ts";

export type ProfileIncludeRef = Brand<`profile:${string}`, "ProfileIncludeRef">;
export type LocalIncludeRef = Brand<`./${string}`, "LocalIncludeRef">;
export type LibraryIncludeRef = Brand<string, "LibraryIncludeRef">;

export type IncludeEntry =
  | { readonly kind: "profile"; readonly value: ProfileIncludeRef }
  | { readonly kind: "local"; readonly value: LocalIncludeRef }
  | { readonly kind: "library"; readonly value: LibraryIncludeRef };

export function parseIncludeEntry(value: string): IncludeEntry {
  if (isProfileRef(value)) {
    return { kind: "profile", value: value as ProfileIncludeRef };
  }
  if (isLocalRef(value)) {
    return { kind: "local", value: value as LocalIncludeRef };
  }
  return { kind: "library", value: value as LibraryIncludeRef };
}

export function profileNameFromInclude(value: ProfileIncludeRef): string {
  return value.slice("profile:".length);
}
