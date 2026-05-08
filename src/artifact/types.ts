export type ArtifactKind = "skill" | "command" | "agent";

export interface Artifact {
  id: string; // domain-qualified path, e.g. 'frontend/skills/react-useeffect'
  kind: ArtifactKind;
  sourceRoot: string; // absolute path to the artifact root (folder for skills, file for command/agent)
  domain: string; // 'frontend'
  basename: string; // 'react-useeffect'
  libraryRoot: string; // absolute path to the home or project library root that owns it
}
