export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type ArtifactKind = "skill" | "command" | "agent";
export type ArtifactId = Brand<string, "ArtifactId">;
export type ArtifactDomain = Brand<string, "ArtifactDomain">;
export type ArtifactBasename = Brand<string, "ArtifactBasename">;
export type AbsolutePath = Brand<string, "AbsolutePath">;
export type RelativePath = Brand<string, "RelativePath">;
export type HashHex = Brand<string, "HashHex">;

export interface ArtifactBase<TKind extends ArtifactKind> {
  readonly id: ArtifactId;
  readonly kind: TKind;
  readonly domain: ArtifactDomain;
  readonly basename: ArtifactBasename;
  readonly libraryRoot: AbsolutePath;
}

export interface SkillArtifact extends ArtifactBase<"skill"> {
  readonly rootDir: AbsolutePath;
  readonly primarySourceFile: AbsolutePath;
}

export interface CommandArtifact extends ArtifactBase<"command"> {
  readonly sourceFile: AbsolutePath;
}

export interface AgentArtifact extends ArtifactBase<"agent"> {
  readonly sourceFile: AbsolutePath;
}

export type Artifact = SkillArtifact | CommandArtifact | AgentArtifact;

export function artifactId(value: string): ArtifactId {
  return value as ArtifactId;
}

export function artifactDomain(value: string): ArtifactDomain {
  return value as ArtifactDomain;
}

export function artifactBasename(value: string): ArtifactBasename {
  return value as ArtifactBasename;
}

export function absolutePath(value: string): AbsolutePath {
  if (!value.startsWith("/")) {
    throw new Error(`Expected an absolute path but got: ${value}`);
  }
  return value as AbsolutePath;
}

export function relativePath(value: string): RelativePath {
  return value as RelativePath;
}

export function hashHex(value: string): HashHex {
  return value as HashHex;
}

export function createSkillArtifact(input: {
  readonly id: string;
  readonly domain: string;
  readonly basename: string;
  readonly libraryRoot: string;
  readonly rootDir: string;
  readonly primarySourceFile: string;
}): SkillArtifact {
  return {
    id: artifactId(input.id),
    kind: "skill",
    domain: artifactDomain(input.domain),
    basename: artifactBasename(input.basename),
    libraryRoot: absolutePath(input.libraryRoot),
    rootDir: absolutePath(input.rootDir),
    primarySourceFile: absolutePath(input.primarySourceFile),
  };
}

export function createCommandArtifact(input: {
  readonly id: string;
  readonly domain: string;
  readonly basename: string;
  readonly libraryRoot: string;
  readonly sourceFile: string;
}): CommandArtifact {
  return {
    id: artifactId(input.id),
    kind: "command",
    domain: artifactDomain(input.domain),
    basename: artifactBasename(input.basename),
    libraryRoot: absolutePath(input.libraryRoot),
    sourceFile: absolutePath(input.sourceFile),
  };
}

export function createAgentArtifact(input: {
  readonly id: string;
  readonly domain: string;
  readonly basename: string;
  readonly libraryRoot: string;
  readonly sourceFile: string;
}): AgentArtifact {
  return {
    id: artifactId(input.id),
    kind: "agent",
    domain: artifactDomain(input.domain),
    basename: artifactBasename(input.basename),
    libraryRoot: absolutePath(input.libraryRoot),
    sourceFile: absolutePath(input.sourceFile),
  };
}

export function withArtifactId<T extends Artifact>(
  artifact: T,
  id: string | ArtifactId,
): T {
  return { ...artifact, id: artifactId(id) } as T;
}
