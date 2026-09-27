# AGENTS.md — {{PROJECT_NAME}}

The single rulebook for every agent in this repo. Agents that don't read this
file natively load it through a shim ({{SHIM_FILES}}) that only adds identity.
**Change rules here, never in a shim.**

---

## 1. Project

<!-- Filled in by the implementing agent from its survey. Keep it to facts an
     agent can't get from reading the code. -->

**What this is:** {{PROJECT_SUMMARY}}

**Facts not obvious from the code:**

- {{PROJECT_FACTS}}

**Where work runs:** {{WORK_LOCATION_POLICY}}

**Collaboration tooling runtime:** {{TOOLING_RUNTIME}}

**Never commit:** anything matching `.agents/forbidden-paths`. To protect a new
kind of path, add a pattern there (see its header) — every guard reads that
file.

## 2. Commands

Tier: **{{TIER}}**. Topology: **{{TOPOLOGY}}**. Integration branch:
**`{{INTEGRATION_BRANCH}}`**. Each step below names an operation; this table
says how to perform it here.

| Operation | How |
|---|---|
| status | {{CMD_STATUS}} |
| claim | {{CMD_CLAIM}} |
| touch | {{CMD_TOUCH}} |
| commit | {{CMD_COMMIT}} |
| block | {{CMD_BLOCK}} |
| finish | {{CMD_FINISH}} |
| reap | {{CMD_REAP}} |
| done | {{CMD_DONE}} |
| rotate | {{CMD_ROTATE}} |
| lint | {{CMD_LINT}} |
| resource probes | {{CMD_PROBES}} |
| one-time setup per clone | {{CMD_SETUP}} |

"By hand" means following the claim protocol and file formats in
`.agents/blueprint/BLUEPRINT.md` §6–§7 exactly; other agents and tools parse
what you write.

## 3. Identity

- Your name comes from your shim. If you loaded only this file, you are
  **`{{DEFAULT_AGENT}}`**. Known agents: {{AGENTS}}.
- A second concurrent session of the same agent uses a suffixed name
  (`claude-wt2`). One name = one claim at a time.
- Anything you launch that outlives your session (cloud workers, containers,
  preview deploys, background jobs) carries the tag `agent:<your-name>` and a
  **run-unique** state/lock path, never a shared default.

## 4. Where state lives

| Path | Holds | Who writes |
|---|---|---|
| {{CLAIMS_DIR}}`<agent>.claim` | that agent's current claim: task, TODO item, paths, `touched` | only its owner (or a reaper) |
| `STATUS.md` | shared resources, last ~{{RECENT_ACTIVITY_MAX}} outcomes (one line each) | anyone, append-style |
| `TODO.md` | goal, `Next`, `Later`, recent `Done` | anyone |
| `CHANGELOG.md` | user-visible and contract-level changes | anyone, append-style |
| `.agents/archive/` | rotated history | rotate / finish |

{{WORKTREE_LEDGER_NOTE}}

When editing a shared ledger by hand, take the lock if this repo's tooling
provides one (BLUEPRINT §6.10), re-read immediately before the edit, and
insert your lines; never rewrite the file from an earlier read. If a rebase or
merge conflicts in `TODO.md` or `CHANGELOG.md`, keep every whole item or entry
from both sides, newest first — never combine lines from two entries.

## 5. The loop

**Session start**
1. Run **status**. It shows active claims (with staleness), the default task,
   and dirty files that may belong to another agent.
2. Read `TODO.md` and `CHANGELOG.md` in full once per session.
3. Default task = first open item under `## Next` that no claim references,
   unless the user redirects.

**Claim** — before anything bigger than one small commit
4. **claim** your task, its TODO item, and the narrowest set of files or
   directories you expect to touch. {{CLAIM_SEMANTICS}} While your claim
   exists, don't edit the first line of the TODO item it references.

**Work**
5. One logical item at a time. Scope grew? Add a TODO item rather than
   silently widening the claim. Need a path outside your claim? Finish and
   re-claim so others can see it.
6. Commit with **commit**, naming exact files. Every commit refreshes your
   claim's `touched:` time; on long stretches without commits, **touch** at
   least every {{STALE_CLAIM_HOURS}}/2 hours. {{TOUCH_NOTE}}
7. If your claim file has disappeared — or a rebase reports a modify/delete
   conflict on it — you were reaped: accept the deletion, keep your work
   commits, don't recreate the file, and re-claim before doing anything else.

**Finish** — in the same commit as the last piece of work
8. {{FINISH_NOTE}} **finish** your claim with a one-line outcome and
   references to earlier commits and run IDs. **done** the TODO item with any limitations. Add a
   CHANGELOG entry if anything user-visible or contract-level changed. Commit
   the work, the ledgers, and the claim-file deletion together. (A commit
   can't contain its own hash; the closing commit is the record.) The claim
   is released for other agents when that commit is published — under `ask`,
   when the user approves the push. That is intended: the next agent must be
   able to see your finished work before it can claim those paths.

**Blocked**
9. **block** with the error, link, or run ID, and publish it. Keep the claim.

**When another agent seems dead**
10. **reap** only claims that **status** labels `STALE — reapable`; anything
    else only on the user's instruction. {{LIVENESS_NOTE}} If the dead agent
    left uncommitted changes inside its claimed paths, stop and ask the user —
    never modify, stash, or discard another agent's work.

**Before your final response**
11. Confirm your claim is finished or intentionally held, and the ledgers
    reflect the work (or say why it was too small to log).

## 6. Commit discipline

- Small commits, one idea each. Conventional prefixes: `feat` `fix` `chore`
  `docs` `refactor` `test`, scoped when useful: `fix(parser): …`.
- **Push policy for work commits: `{{PUSH_POLICY}}`.** `auto`: push right
  after every commit. `ask`: confirm with the user before pushing.
  A commit containing only claim files and ledgers, with no unpushed commits
  beneath it, is a *coordination* commit and is pushed immediately regardless
  (clones only; single-machine claims aren't committed). Any other commit is a
  work commit and follows the policy.
- Never amend, rebase, or force-push commits that have been pushed.
- Never `--no-verify`. If the guard blocks you, either the guard is right or
  `.agents/forbidden-paths` needs a change the user reviews.
- Never `git add -A`, `git add .`, `git add <directory>`, or `git commit -a`.
  Commit with a pathspec: `git commit -m "<msg>" -- <exact paths>`. Agents may
  share a working tree **and its index**; a plain `git commit` would include
  files another agent staged.

## 7. Ask the user first

- **Externally visible** actions beyond pushes allowed above:
  bucket/registry writes, issues, messages, deploys.
- **Destructive** actions: deleting large or non-regenerable files, dropping
  data, destroying resources, rewriting history.
- **Unattributed resources** (`agent:unknown` or untagged): may be a human's
  manual experiment.
- **Reaping a claim status doesn't label `STALE — reapable`**, or one whose
  paths contain uncommitted changes.

## 8. Housekeeping

- Run **lint** when status reports a problem; fix structure before continuing.
- Run **rotate** when a ledger is over budget; commit as `chore(ledger): rotate`.
