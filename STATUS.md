# STATUS.md

Coordination ledger for `ObservabilityLab`. Written by several agents, so edit
it append-style: re-read immediately before editing, insert your line, never
rewrite from an earlier read. It merges with `merge=union`, which is only safe
because every Recent activity item is **exactly one line**.

Recent activity item (newest first, at most 10; older go to
`.agents/archive/recent-activity.md`):

    - <YYYY-MM-DDTHH:MMZ> — <agent> — **<task>.** <outcome> (<earlier commits, run IDs>)

## Active work

Claims live in the `agent-collab/claims/` folder inside `git rev-parse
--git-common-dir` (this topology is `shared-tree`: claims are untracked and
never appear in `git ls-files`), one `<agent>.claim` file per agent, written
only by its owner. Run **status** (AGENTS.md §2) for a rendered view with
liveness.

## Shared resources

Long-lived things agents launch, tagged `agent:<name>`. Untagged means ask the
user before touching. Live view: the resource probes in AGENTS.md §2.

- Last known-good run: —
- No resource kinds registered yet (no Docker Compose, cloud workers, or
  background jobs exist as of this framework's adoption).

## Recent activity
- 2026-09-27T04:39Z — claude — **Implement the multi-agent collaboration system per agent-collab/BLUEPRINT.md.** Adopted Tier 2 multi-agent collaboration protocol (claude, codex; shared-tree; push=auto). (.agents/blueprint/BLUEPRINT.md §9-§10)

Newest first; CHANGELOG.md holds the long arc.
