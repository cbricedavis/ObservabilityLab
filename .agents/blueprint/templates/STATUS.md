# STATUS.md

Coordination ledger for `{{PROJECT_NAME}}`. Written by several agents, so edit
it append-style: re-read immediately before editing, insert your line, never
rewrite from an earlier read. It merges with `merge=union`, which is only safe
because every Recent activity item is **exactly one line**.

Recent activity item (newest first, at most {{RECENT_ACTIVITY_MAX}}; older go to
`.agents/archive/recent-activity.md`):

    - <YYYY-MM-DDTHH:MMZ> — <agent> — **<task>.** <outcome> (<earlier commits, run IDs>)

## Active work

Claims live in {{CLAIMS_DIR}}, one `<agent>.claim` file per agent, written
only by its owner. Run **status** (AGENTS.md §2) for a rendered view with
liveness.

## Shared resources

Long-lived things agents launch, tagged `agent:<name>`. Untagged means ask the
user before touching. Live view: the resource probes in AGENTS.md §2.

- Last known-good run: —

## Recent activity

Newest first; CHANGELOG.md holds the long arc.
