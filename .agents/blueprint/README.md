# agent-collab — a blueprint for multi-agent coordination

This folder is a **specification**, not an installer. It describes how several
coding agents (Claude Code, Codex, Gemini, Copilot, …) coordinate on one git
repository, and it tells an agent how to build that system inside a specific
project using whatever runtime that project already has. There is no code in
here, so nothing assumes bash, Python, Node, or PowerShell.

## Contents

| File | For | Purpose |
|---|---|---|
| `BLUEPRINT.md` | the implementing agent | Survey → decide → build → verify. Contracts for every component, cross-platform rules, acceptance scenarios. |
| `templates/AGENTS.md` | the project | The single rulebook every agent follows. |
| `templates/SHIM.md` | the project | Per-agent file (`CLAUDE.md`, `GEMINI.md`, …) that imports the rulebook and states identity. |
| `templates/claim` | the project | Shape of a per-agent claim file in `.agents/claims/`. |
| `templates/claims-README` | the project | Clones topology only: keeps `.agents/claims/` tracked and explains it. |
| `templates/STATUS.md` | the project | Shared resources and recent outcomes. |
| `templates/TODO.md` | the project | Goal, prioritized backlog, Done. |
| `templates/CHANGELOG.md` | the project | User-visible history. |
| `templates/config` | the project | Settings every implementation reads. |
| `templates/forbidden-paths` | the project | Never-commit patterns, in a regex subset portable across languages. |
| `templates/archive-README` | the project | Keeps `.agents/archive/` tracked before the first rotation. |
| `templates/gitattributes` | the project | LF endings; union merge only where items are one line. |

## Adopting it in a project

Copy this folder into the repo at `.agents/blueprint/` (the installed
rulebook points there for file formats and by-hand operations), then tell one
agent:

> Read `.agents/blueprint/BLUEPRINT.md` and implement the collaboration system
> in this repo. Agents: claude, codex. Ask me anything the survey can't answer.

The agent surveys the repo, chooses a tier and a runtime that fits it, writes
the documents, builds whatever tooling the tier calls for, runs the acceptance
scenarios, and reports back. The other agents then just follow `AGENTS.md`.

## Tiers

- **Tier 0 — Protocol.** Rulebook + ledgers, edited by hand to a strict format.
  Works anywhere, needs nothing but git. Good for small or short-lived repos.
- **Tier 1 — Guard.** Tier 0 plus an automatic block on committing forbidden
  paths (git hook and/or CI check). The minimum for anything touching secrets
  or private data.
- **Tier 2 — Helpers.** Tier 1 plus commands for status / claim / touch /
  commit / block / finish / reap / done / rotate / lint, so the protocol is
  enforced by tooling instead of discipline.
  Worth it once two agents run concurrently for more than a day or two.

## Where this came from

Extracted from a real two-agent project (Claude Code + Codex on one Mac, one
working tree), including the failures that shaped it: parallel work silently
overwriting each other, one agent's staged files landing in the other's commit,
a path guard that missed subdirectories, orphaned cloud workers from a shared
state file, and ledgers that grew to ~2,000 lines because trimming was a manual
rule. Two rounds of design review then found the concurrency gaps: a lost-update
race on a single shared claim list, no way to release a dead agent's claim,
claims and heartbeats that stayed invisible under an ask-before-push policy,
and `merge=union` silently splicing multi-line changelog entries (confirmed by
test). Per-agent claim files, a lock-based claim on one machine,
publish-then-verify across clones, and a per-file write-discipline table
(`BLUEPRINT.md` §2 and §7) close them.
`BLUEPRINT.md` states each invariant with the failure it prevents.
