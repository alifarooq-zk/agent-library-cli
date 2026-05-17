# ADR 0012: Home Flag Subcommand Overload

Date: 2026-05-16
Status: Accepted

## Context

The `--home` flag has two dev and test jobs: point `sync <project>` or `init <project>` at a pre-materialised library tree, and point `sync --global` or `init --global` at an alternate home base.

## Decision

Keep one `--home` flag and let the subcommand disambiguate it. Without `--global`, `--home` means library tree. With `--global`, `--home` means home base. Splitting the flag into `--library-root` and `--home-base` would add more churn than clarity for this affordance.

## Consequences

`HOME_AGENT_LIBRARY` applies only to the library-tree job. Command help and docs must state which meaning applies for each subcommand.
