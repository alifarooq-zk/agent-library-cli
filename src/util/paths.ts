import { basename } from "node:path";

/** Split 'frontend/skills/react-useeffect' → { domain: 'frontend', rest: 'skills/react-useeffect' } */
export function splitDomain(id: string): { domain: string; rest: string } {
  const slash = id.indexOf("/");
  if (slash === -1) return { domain: id, rest: "" };
  return { domain: id.slice(0, slash), rest: id.slice(slash + 1) };
}

/** Returns true if the entry is a profile reference like 'profile:frontend' */
export function isProfileRef(entry: string): boolean {
  return entry.startsWith("profile:");
}

/** Returns true if the entry is a project-local path like './something' */
export function isLocalRef(entry: string): boolean {
  return entry.startsWith("./");
}

/** Strip the file extension and return the basename stem */
export function stemName(filePath: string): string {
  const b = basename(filePath);
  const dot = b.lastIndexOf(".");
  return dot > 0 ? b.slice(0, dot) : b;
}
