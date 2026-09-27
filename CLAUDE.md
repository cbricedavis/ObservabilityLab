# CLAUDE.md

@AGENTS.md

## Identity

You are **`claude`**. Use this name in every claim, ledger entry, and helper
invocation, and tag anything you launch with `agent:claude`.

All working rules live in `AGENTS.md`. Don't restate them here — add only
notes specific to this agent's tooling.

## claude-specific notes

- Export `AGENT=claude` before running any `.agents/bin/agents.mjs` command
  (AGENTS.md §2). Without it, the tool assumes you are `codex`, the default
  agent, and your claim/commit/finish calls will act under the wrong name.
- A second concurrent Claude Code session (e.g. a worktree opened for
  parallel exploration) is a separate identity: use `AGENT=claude-wt2`, etc.
  Don't run two sessions as plain `claude` at once.
