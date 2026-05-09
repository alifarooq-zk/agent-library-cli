# ADR 0008: Bun TypeScript CLI Stack

Date: 2026-05-08
Status: Accepted

## Context

The CLI should be easy to test, fast to run, and distributable without requiring end users to install the development runtime.

## Decision

Build the CLI as a TypeScript package using Bun. Use:

- Bun for runtime, dependency management, tests, and executable compilation.
- TypeScript 5 for source code.
- Commander for command routing.
- `@clack/prompts` for interactive `init`.
- Zod for structured validation.
- `yaml` for manifests and lockfiles.
- Chalk for terminal colors.
- Node-compatible `crypto` for hashing.

Version 1 builds a current-platform executable with Bun. The current target is `bun-linux-x64`.

## Consequences

Development stays close to the TypeScript projects that will use the tool.

End users can run the compiled executable without installing Bun.

Cross-platform release packaging remains a later concern.

