# BLUEPRINT.md — building the multi-agent collaboration system

**Audience:** the agent implementing this in a project. Read the whole file
before changing anything. Work through §3–§10 in order. Ask the user only what
the survey (§3) cannot determine.

Terms: **agent** = one AI coding assistant session identity (`claude`,
`codex`, `claude-wt2`, …). **Ledgers** = `STATUS.md`, `TODO.md`,
`CHANGELOG.md` and their archives. **Claim** = an agent's declaration of the
task and paths it is working on. **Integration branch** = the branch where
ledgers live and agents integrate (usually `main`). **Single-machine** =
`shared-tree` or `worktrees` topology (§3.2). **Common dir** = the output of
`git rev-parse --git-common-dir`, shared by all worktrees of a repo and never
committed. MUST / SHOULD / MAY carry their usual meaning.

---

## 1. What you are building

Git is the only channel between agents on different machines; on one machine
the git common dir is. Each active agent has one claim file. The ledgers hold
the backlog, recent outcomes, and history. Every agent follows one rulebook
(`AGENTS.md`); agents that don't read it natively get a thin shim pointing to
it. Depending on the tier (§4), tooling enforces what discipline gets wrong.

## 2. Invariants

Every tier MUST preserve these. Each exists because its absence caused a real
failure, or because a test in review showed it would.

| # | Invariant | Failure it prevents |
|---|---|---|
| I1 | An agent holds a claim for task + paths **before** writing code (§7). | Two agents rewrite the same feature in parallel; one discards the other's work. |
| I2 | Commits name exact paths. Never `git add -A`, `git add .`, `git add <dir>`, `git commit -a`. | In a shared working tree, bulk adds capture another agent's in-flight edits. |
| I3 | Commits are pathspec-scoped (`git commit -- <paths>`), not only the staging step. | A shared tree shares the **index**: another agent's staged files ride along in a plain `git commit`. |
| I4 | One pattern list defines never-commit paths; every guard reads it and fails closed on an invalid pattern. | Two hand-copied regexes both missed descendants of protected directories. |
| I5 | One rulebook. Shims import it and add only identity and agent-specific notes. | Two near-identical rule files drift apart. |
| I6 | Anything an agent launches that outlives its session is tagged with the agent name and uses run-unique state. | Concurrent launches shared a state file, tore down the wrong workers, left unattributable orphans. |
| I7 | Ledgers have size budgets enforced by rotation, not by a "please trim" rule. | Ledgers reached ~925 / ~1,450 / ~1,970 lines while the rules said "read in full every session." |
| I8 | Rules don't contradict each other; the guard has no bypass. | "Never `--no-verify`" beside "use `--no-verify` in an emergency"; "push immediately" beside "confirm first." |
| I9 | A commit never has to contain its own hash. Closing entries reference *earlier* commits; the closing commit is the record. | An impossible ritual step every agent quietly faked. |
| I10 | Collaboration files are UTF-8 without BOM, LF, `/`-separated repo-relative paths, UTC ISO-8601 times. | Tooling on one OS mis-parsing files written on another. |
| I11 | Every file has a declared write discipline (table below), and `merge=union` is used **only** on files whose items are exactly one line. | Lost updates on read-modify-write; verified in testing: union merge splices concurrent multi-line entries (a bullet from one entry lands in the other and blank separators vanish) and deduplicates identical continuation lines. |
| I12 | A claim is either provably live or reapable by a defined procedure, and liveness is only ever judged from information the judging agent can actually see. | A crashed agent holds `src/` forever; or a live agent is reaped because its heartbeat never left its machine. |

**Write discipline (I11):**

| File | Writers | Concurrency control | Git merge |
|---|---|---|---|
| Claim file | its owner; a reaper | single writer; on one machine also the lock (§6.10) | n/a on one machine (not committed); clones: one writer per file, never conflicts |
| `STATUS.md` | anyone | lock on one machine; append-style edits | `merge=union`; Recent activity items MUST be one line |
| `.agents/archive/recent-activity.md` | finish / rotate | lock | `merge=union` (one-line items) |
| `TODO.md` | anyone | lock on one machine | normal merge; conflicts resolved by rule §6.12 |
| `CHANGELOG.md` and other archives | anyone / rotate | lock on one machine | normal merge; conflicts resolved by rule §6.12 |

In `worktrees`, claims are shared immediately (common dir) but ledgers are
branch-local: each worktree sees its own branch's `TODO.md`, `STATUS.md`, and
`CHANGELOG.md` until they are merged onto the integration branch. Don't copy
ledgers into the common dir, and don't treat one worktree's `status` backlog
as global.

## 3. Survey (read-only)

Determine, and write down for your final report:

1. **Agents.** Which will work here? Look for `AGENTS.md`, `CLAUDE.md`,
   `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules`. Which reads
   `AGENTS.md` natively (Codex does)? That is the **default agent**; the rest
   get shims.
2. **Topology.** Exactly one of:
   - `shared-tree`: agents share one checkout (working tree and index).
   - `worktrees`: one machine, a `git worktree` per agent. Git refuses to
     check out one branch in two worktrees; don't override that with
     `--force`/`--ignore-other-worktrees`. Worktrees share claims
     immediately; ledgers are branch-local until merged onto the integration
     branch.
   - `clones`: separate clones, possibly separate machines.
   A second concurrent session of one agent is a separate identity
   (`claude-wt2`): one identity holds at most one claim.
3. **Branching.** In `clones`, agents MUST commit to the integration branch
   (trunk-based), or claims are invisible to each other. Per-agent feature
   branches across clones are out of scope; recommend `worktrees` or trunk.
4. **Platforms and shells** used by agents and humans.
5. **Runtimes already required on every platform:** Node, .NET/PowerShell 7,
   Python, Go, Rust, JVM, or none.
6. **Existing guards:** `.gitignore`, hooks, hook managers, CI.
7. **Sensitive paths**, including any already tracked.
8. **Long-lived resources** agents launch.
9. **Existing ledgers** to migrate rather than duplicate.
10. **Each agent's write access.** From each agent's actual runtime and
    sandbox mode (not the implementer's), confirm it can run `git commit`
    and create a directory inside `git rev-parse --git-common-dir`.
    Single-machine claims and the lock live there (§6.1, §6.10); an agent
    that can't write there can't claim. Record the result per agent. If an
    agent can't be checked now, record that; X1 (§9) will check it.

Ask the user only for what remains — usually the agent list, push policy,
tier, and sensitive-path confirmation.

## 4. Decide tier and runtime

### Tier

| Tier | Adds | Choose when |
|---|---|---|
| 0 Protocol | Rulebook, shims, claims, ledgers, config, pattern list, `.gitattributes` | Low-risk repo; agents rarely overlap in time. |
| 1 Guard | Forbidden-path hook, CI twin, tracked-file audit | Any repo with secrets, private data, or large artifacts. Default minimum. |
| 2 Helpers | `status`, `claim`, `touch`, `block`, `finish`, `reap`, `done`, `commit`, `rotate`, `lint` | Agents run concurrently; shared tree; or ledgers already large. |

### Runtime

Tooling MUST run on every platform from §3.4 without adding a dependency the
project doesn't already require:

1. **The project's own primary runtime** if it is required everywhere.
   Register commands where that ecosystem expects them.
2. **POSIX `sh` for the hook** (reference in §6.4). Git for Windows runs hooks
   with its bundled `sh` and GNU grep. No bash-4 features (macOS ships 3.2);
   no `jq`, `python3`, or GNU-only flags.
3. **Single-machine only: a runtime present on the machine.** For
   `shared-tree` or `worktrees`, a runtime that is already installed where
   every agent runs (not required by the project) is acceptable if the user
   confirms it. Use it dependency-free, without adding a manifest that
   implies a product stack, and record the choice in `AGENTS.md` §1 so no
   later agent "corrects" it. Not allowed for `clones`, where machines
   differ.
4. **No runtime (Tier 0/1 only).** Stop at Tier 1; agents perform operations
   by hand to §6–§7.

If the project uses a hook manager, register the guard through it.

## 5. Build order

1. Claim this work (§7). You are subject to the protocol you're building.
2. Install documents from `templates/`, replacing every `{{PLACEHOLDER}}` with
   a valid value (dates as UTC `YYYY-MM-DD`). Never overwrite silently: merge,
   or write `<name>.new` and tell the user.
   - `AGENTS.md` at repo root; fill §1 and the Commands table.
   - One shim per non-default agent, named what that agent auto-loads, using
     its import syntax if any (`@AGENTS.md` for Claude Code and Gemini CLI),
     otherwise the template's plain-words pointer.
   - `STATUS.md`, `TODO.md`, `CHANGELOG.md`; migrate existing equivalents.
   - `.agents/config`, `.agents/forbidden-paths`, and
     `.agents/archive/README` from `templates/archive-README` (git doesn't
     track empty directories; archive files appear on first rotation and are
     optional until then).
   - Claims directory (§6.1): for `clones`, `.agents/claims/README` from
     `templates/claims-README`; for single-machine, nothing to commit — the
     directory is created in the common dir on first claim.
   - `.gitattributes` lines from `templates/gitattributes`.
   - This blueprint at `.agents/blueprint/` if not already there; `AGENTS.md`
     points to it for formats and by-hand operations.

   Non-obvious placeholders: `{{SHIM_FILES}}` lists shim names; `{{CMD_*}}` is
   the exact invocation here, or "by hand — see BLUEPRINT §6–§7" at Tier 0/1;
   `{{CLAIMS_DIR}}` is the claims directory (§6.1) for this topology,
   written with exactly one trailing slash (`.agents/claims/`, or
   `<common dir>/agent-collab/claims/` spelled as "the `agent-collab/claims/`
   folder inside `git rev-parse --git-common-dir`");
   `{{TIER_SUMMARY}}` is one sentence on what the tier enforces;
   `{{ADOPTION_FOLLOWUPS}}` lists deferred work; `{{CLAIM_SEMANTICS}}` is one
   sentence on when a claim becomes Held here (single-machine: "The claim
   is yours as soon as the command succeeds." Clones: "The claim is yours
   only after it is pushed and verified; if an earlier overlapping claim
   wins, you withdraw and pick another item."); `{{LIVENESS_NOTE}}` is the
   §7.5 row for this topology and push policy in one sentence (clones +
   `ask`: "Liveness of other clones' claims can't be seen here, so every
   reap needs the user's instruction.");
   `{{WORKTREE_LEDGER_NOTE}}` is, for `worktrees`, "Claims are shared across
   worktrees immediately; ledgers are branch-local until merged onto
   `<integration branch>`, so your backlog view is your branch's," and empty
   otherwise; `{{TOUCH_NOTE}}` is, for clones + `ask`, "While you have
   unpushed work, a touch can't be published — your liveness is visible only
   after the user approves a push," and empty otherwise; `{{FINISH_NOTE}}` is,
   for single-machine at Tier 2, "On this machine `finish` makes the closing
   commit itself, so pass it your paths instead of committing separately,"
   and empty otherwise. `{{TOOLING_RUNTIME}}` names the runtime the helpers
   use and why (e.g. "Dependency-free Node, present on this Mac; chosen
   independently of the product stack" or "None — Tier 1, hook is POSIX
   sh").
3. Tier ≥1: hook (§6.4), CI twin, tracked-file audit.
4. Tier 2: helpers (§6.5–§6.11), one at a time, with tests.
5. Run the acceptance scenarios for your tier and topology (§9).
6. Finish your claim, add the CHANGELOG entry, commit by exact paths.

## 6. Component contracts

### 6.1 File grammar

**The claims directory.** Single-machine: `<common dir>/agent-collab/claims/`
(untracked, shared by every worktree; no commits, no merge leakage between
branches). Clones: `.agents/claims/` (tracked). Every operation that reads or
writes claims — `status`, `claim`, `touch`, `block`, `finish`, `reap`,
`commit`'s reaped check, `done`'s claimed-item check, the default task,
`lint`, and Tier 0 by-hand work — uses this directory for the configured
`TOPOLOGY`, never a hard-coded path. Writers create it (with parents) if it
doesn't exist; single-machine writers do so under the lock. Readers treat a
missing directory as "no claims."

**Claim file** `<claims dir>/<agent>.claim`. Exists iff the agent holds a
claim. `key: value` lines in this order; repeatable keys zero or more times:

```
agent: claude
since: 2026-09-26T18:00Z
touched: 2026-09-26T19:42Z
task: Parse nested config blocks
todo: **Support nested config blocks.**
paths: src/config/parser.ts, src/config/nested/, docs/config.md
note: <free text>                         (repeatable)
blocker: 2026-09-26T19:40Z <note>         (repeatable)
```

- `todo:` is the verbatim first line of the claimed `TODO.md` item after the
  `- [ ] ` marker, or `-`. While claimed, that first line is **frozen**: no one
  edits it (lint errors if a `todo:` matches nothing).
- `paths:` comma-separated; trailing `/` claims a directory and its contents.
  `.` and empty are invalid.
- Values run to end of line; no quoting; never a newline.

**TODO reference matching** (used by claim pre-check, default task, `done`,
lint): trim both strings, compare case-insensitively. One function, used
everywhere.

**STATUS.md** sections, in order: `## Active work`, `## Shared resources`,
`## Recent activity`.
- `Active work` holds only a pointer to the claims directory and `status`.
- `Recent activity`: optional one-line intro, then newest-first items, **each
  exactly one line**: `- <UTC time> — <agent> — **<task>.** <outcome> (<refs>)`.
  At most `RECENT_ACTIVITY_MAX`; overflow to
  `.agents/archive/recent-activity.md`.

**TODO.md** sections, in order: `## Current Goal`, `## Next`, `## Later`,
`## Done`.
- Items `- [ ] ` / `- [x] `, continuation lines indented two spaces; `###`
  subheadings may group items in `Next`/`Later`.
- **Default task** = first open `Next` item whose first line matches no
  claim's `todo:`. Claims are the mutex; TODO is advisory plus the pointer.
- Completed item → top of `Done` as `- [x] <YYYY-MM-DD>: <original text>`
  plus an indented line with earlier commits, run IDs, limitations. Beyond
  `DONE_KEEP`, oldest → `.agents/archive/TODO-done.md`.

**CHANGELOG.md**: intro, then newest-first entries starting
`## <YYYY-MM-DD> — <headline>`. Beyond `CHANGELOG_KEEP`, oldest →
`.agents/archive/CHANGELOG-archive.md`; the file ends with exactly one
pointer line.

**All ledgers and archives:** section detection is by a line exactly equal
to `## <Title>`; the heading set is an allowlist (each required heading once,
nothing else at `## ` except CHANGELOG entries). Tool-written text never begins
a line with `#`; indent it. No runs of blank lines. Archives are newest-first;
rotation only inserts at the top of an archive, never deletes from one.

### 6.2 Config — `.agents/config`

One `KEY = value` per line; value = everything after the first `=`, trimmed,
spaces allowed. Full-line `#` comments only. Lists are space-separated; agent
names match `[a-z0-9][a-z0-9-]*`.

| Key | Meaning | Default |
|---|---|---|
| `PROJECT_NAME` | display name | — |
| `AGENTS` | agent names | — |
| `DEFAULT_AGENT` | agent that reads only `AGENTS.md` | `codex` |
| `TOPOLOGY` | `shared-tree`, `worktrees`, `clones` | from survey |
| `INTEGRATION_BRANCH` | where ledgers live | `main` |
| `PUSH_POLICY` | `auto` or `ask`, for work commits (§7.4) | `ask` |
| `RECENT_ACTIVITY_MAX` | STATUS recent items kept | `10` |
| `DONE_KEEP` | TODO Done items kept | `25` |
| `CHANGELOG_KEEP` | CHANGELOG entries kept | `20` |
| `LEDGER_WARN_LINES` | lint warns above | `400` |
| `STALE_CLAIM_HOURS` | untouched claim becomes reapable (§7.5) | `24` |
| `LOCK_WAIT_SECONDS` | how long to retry a held lock | `30` |
| `LOCK_STALE_SECONDS` | lock age after which it may be broken | `120` |

### 6.3 Forbidden paths — `.agents/forbidden-paths`

One pattern per line; blank lines and full-line `#` comments ignored; **no
inline comments**; readers strip a trailing `\r`. Patterns match the
normalized path (§8) anywhere unless anchored.

Portable subset (identical in POSIX ERE, GNU/BSD `grep -E`, JavaScript, .NET,
Python, Go RE2, Rust `regex`, PowerShell): literals; escaped punctuation;
`^ $ . * + ?`; `( | )`; bracket classes like `[^/]`. No lookaround,
backreferences, `\d \w \s`, POSIX classes, or inline flags. An invalid
pattern MUST make every guard fail closed.

Case: case-insensitive iff `git config --bool core.ignorecase` is `true`.

### 6.4 Guard (Tier ≥1)

**Hook.** Blocks any commit whose paths match §6.3. For pathspec commits git
sets `GIT_INDEX_FILE` to a temporary index, so `--cached` sees exactly what is
being committed. Reference (POSIX `sh`; tested under `dash`, with CRLF pattern
files, non-ASCII names, `core.ignorecase`, an invalid pattern, and `set -e`):

```sh
#!/bin/sh
# Blocks commits containing paths listed in .agents/forbidden-paths.
# POSIX sh; needs only git, tr, grep, mktemp. Safe under `set -e`.
# ([[:space:]] is fine here: the POSIX-class ban applies to patterns, not this script.)
root=$(git rev-parse --show-toplevel) || exit 1
pat="$root/.agents/forbidden-paths"
[ -f "$pat" ] || exit 0
clean=$(mktemp) || exit 1
trap 'rm -f "$clean"' EXIT
tr -d '\r' < "$pat" | grep -v -E '^[[:space:]]*(#|$)' > "$clean" || true
[ -s "$clean" ] || exit 0
icase=
[ "$(git config --bool core.ignorecase)" = true ] && icase=-i
rc=0
hits=$(git -c core.quotePath=off diff --cached --name-only --diff-filter=ACMRT \
       | grep -E $icase -f "$clean") || rc=$?
if [ "$rc" -gt 1 ]; then
  echo "pre-commit: .agents/forbidden-paths has an invalid pattern; refusing (fail closed)" >&2
  exit 1
fi
if [ -n "$hits" ]; then
  printf 'pre-commit: forbidden paths (.agents/forbidden-paths):\n%s\n' "$hits" >&2
  printf 'unstage: git restore --staged -- <path>\n' >&2
  exit 1
fi
exit 0
```

File names containing newlines are unsupported. No bypass; the rulebook
forbids `--no-verify`. Install by **reference**, never by copying: set
`git config core.hooksPath .githooks` (idempotent, once per clone), or
register the tracked hook through the project's hook manager. A copy in
`.git/hooks/` silently stays old when the tracked hook changes. If a copy
from an earlier install exists, leave it; it's inert once `core.hooksPath`
is set.

**CI twin.** Same matching over `git diff --name-only <base>...<head>`.

**Tracked-file audit.** The hook only sees commits, so a forbidden file tracked
before the hook existed passes forever. CI and `lint` MUST match
`git ls-files` against the patterns and fail on hits, telling the user to
`git rm --cached` the file and rotate any exposed secret.

### 6.5 `status` (Tier 2)

Read-only. Prints: project name and UTC time; branch vs upstream after a fetch
(tolerating failure); last commit; topology and push policy; dirty and staged
paths (labelled "may be another agent's"); **active claims** from the claims
directory, each with age since `touched` and a liveness label per §7.5
(`live`, `STALE — reapable`, or `liveness unknown — reap needs the user`); the
default task; newest CHANGELOG entry; `lint` output; resource probes (§6.11).
Never prints secrets or file contents.

### 6.6 `claim` (Tier 2)

Implements §7.2 (single-machine) or §7.3 (clones). Refuses with a reason on a
failed precondition or overlap; in clones, withdraws with a reason when
verification finds an earlier overlapping claim. Prints the claim and the TODO
item it took.

### 6.7 `touch`, `block`, `finish`

- `touch(agent)`: sets `touched:` to now. Single-machine: a read-modify-write
  of the claim file under the lock (§6.10), instantly visible. Clones: a
  commit of the claim file only. If unpushed work commits sit beneath it
  (clones + `ask`), it cannot be published without that work (§7.4): commit
  it anyway, tell the agent its liveness stays unpublished until the user
  approves the push, and don't push.
- `block(agent, note)`: appends `blocker:` to the claim; adds
  `- [ ] **Blocker (<agent>, <task>):** <note>` at the top of `Next`. Clones:
  commit the claim file and `TODO.md` (coordination if nothing unpushed is
  beneath it). Single-machine: commit `TODO.md`.
- `finish(agent, outcome, refs?, paths…)`: releases the claim together with
  the closing work commit (I9), so the paths are never unclaimed while the
  work is uncommitted.
  - **Single-machine:** acquire the lock and hold it throughout. Prepend the
    one-line Recent activity item (budget + overflow), then perform the
    closing commit (§6.9) of the caller's paths plus the ledgers. Only if
    that commit succeeds, delete the claim file. Release the lock. If the
    commit is refused, keep the claim, leave the ledger edits in place for
    the agent to fix, release, and report. `finish` runs the commit itself
    while holding the lock; it must not re-acquire it, and
    `LOCK_STALE_SECONDS` must exceed a normal commit including hooks.
  - **Clones:** delete the claim file and prepend the Recent activity item;
    the agent includes both in its closing work commit. Publication follows
    §7.4.
  - If the agent dies after the commit but before the claim is deleted, the
    claim goes stale with clean paths and is reaped normally.

### 6.8 `reap` (Tier 2; Tier 0 by hand)

Releases another agent's claim. Allowed only when §7.5 labels it
`STALE — reapable`, or the user explicitly instructs it. Clones: fetch first
and judge from the fetched state.

1. List dirty or staged paths inside the target's claimed paths
   (single-machine). If any, stop and ask the user — it may be unfinished work.
   Never modify, stash, or discard it.
2. Delete the target's claim file (single-machine: under the lock; clones: in
   a commit).
3. Prepend a one-line Recent activity item:
   `- <time> — <reaper> — **Reaped <target>: <task>.** <reason>`.
4. If the claim had a `todo:`, add at the top of `Next`:
   `- [ ] **Resume (reaped from <target>):** <task>` with the original `todo:`
   on a continuation line.
5. Commit the ledger changes (and, in clones, the claim-file deletion) as
   `chore(claims): <reaper> reaps <target>`; publish per §7.4.

An agent that finds its claim file gone was reaped: it is Idle, must not
recreate the file, and must re-run the claim protocol. In clones, the owner
usually discovers this as a **modify/delete conflict on its own claim file**
during `pull --rebase` (it touched or committed; the reaper deleted). Resolve
by accepting the deletion (`git rm` the claim file), continue the rebase so
its work commits survive, report "reaped," and stop before further work.

### 6.9 `commit` (Tier 2)

Refuses: empty path lists; bulk specs (`.`, `*`, `-A`, `--all`); directories
("list files, not the claim root — claims may name directories, commits may
not"); forbidden paths; paths that neither exist nor are tracked (deleting a
tracked file is allowed); and any call by an agent whose claim file has
disappeared since it last saw it ("you were reaped; re-claim").

Warns but proceeds: non-conventional message; non-ledger paths outside the
caller's claim; no claim held.

Then: update `touched:` in the caller's claim — single-machine, a
read-modify-write under the lock (§6.10) unless the caller already holds it
(as `finish` does); clones, include the claim file in the commit; stage exactly the paths; `git commit -m <msg> -- <paths>`;
retry up to three times on a held `index.lock` (another agent is committing);
report how many other dirty paths were left alone; publish per §7.4. A
modify/delete conflict on the caller's own claim file during a rebase means
it was reaped (§6.8).

### 6.10 The lock

One lock per repo: the directory `<common dir>/agent-collab.lock`, created
with a single atomic `mkdir`. The holder writes `owner` (agent, pid, UTC time)
inside it. It guards every read-modify-write of a ledger or a single-machine
claim file: acquire → re-read → edit → write (temp file + rename) → release
(`rmdir` after removing `owner`).

- **Held:** retry `mkdir` with a short backoff for up to `LOCK_WAIT_SECONDS`.
- **Stale** (older than `LOCK_STALE_SECONDS`): break it by *renaming* the lock
  directory to `agent-collab.lock.stale.<pid>`, then delete that. Rename is
  atomic, so of two concurrent breakers exactly one succeeds; the other's
  rename fails and it goes back to retrying `mkdir`.
- **Still unavailable after the wait:** refuse, naming the owner. Never fall
  back to writing without the lock.

The lock is per machine. Clones never share it; there, git merge rules
(§2 table, §6.12) are the concurrency control.

### 6.11 `done`, `rotate`, `lint`, resource probes

- `done(match, note?)`: finds exactly one open item whose text (including
  continuation lines) matches, per the TODO matching function; refuses on zero
  or several; **refuses if another agent's claim references it**; moves it per
  §6.1 recording the current short HEAD as "last prior commit" — the commit
  before your closing commit, deliberately (I9).
- `rotate`: applies `DONE_KEEP` and `CHANGELOG_KEEP`; idempotent.
- `lint`: non-zero on: a missing **required** file; heading set not exactly the allowlist
  (missing, duplicated, extra, trailing whitespace); merge markers; a claim
  file that doesn't parse, whose `agent:` differs from its file name, or whose
  `paths:` is empty or `.`; a `todo:` that matches no open item; a
  multi-line Recent activity item; a forbidden tracked file; an invalid
  pattern in `.agents/forbidden-paths` (fail closed, as every guard must);
  an active pre-commit hook that isn't the tracked one (`core.hooksPath`
  not `.githooks`, and no hook manager registered). Warns on:
  ledgers over `LEDGER_WARN_LINES`; claims not `live` per §7.5; directory
  claims at repo top level untouched for more than half the stale window.
  Fast enough to run every session start.

  File set, so every implementation agrees on a clean install:
  - **Required:** `AGENTS.md`, `STATUS.md`, `TODO.md`, `CHANGELOG.md`,
    `.agents/config`, `.agents/forbidden-paths`, `.agents/archive/README`, and
    in clones `.agents/claims/README`.
  - **Optional until first written** (absence is not an error): archive
    content files (`recent-activity.md`, `TODO-done.md`,
    `CHANGELOG-archive.md`), the claims directory, and every `.claim` file.
    Once an optional file exists, it is checked like any other.
- **Resource probes:** for each resource kind from §3.8, a read-only probe
  listing instances with `agent:<name>` (or `agent:unknown`) and age. Existing
  launchers MUST tag and use run-unique state (I6).

### 6.12 Ledger conflicts (clones and branch merges)

`TODO.md`, `CHANGELOG.md`, and multi-line archives use normal merges. When a
rebase or merge conflicts in one of them, resolve by **keeping every whole
item or entry from both sides**, newest first, never combining lines from two
items into one. An item moved to `Done` on one side and edited on the other
keeps the `Done` version with the edit carried in. Then run `lint`. Tier 2
MAY automate this; Tier 0 agents do it by hand.

## 7. The claim protocol

### 7.1 Overlap

Normalize both paths (§8), strip one trailing `/`, compare case-insensitively
iff `core.ignorecase`. `a` and `b` overlap iff `a == b`, or `b` starts with
`a + "/"`, or `a` starts with `b + "/"`. Ledger files never overlap. Two claims
also conflict if their `todo:` values match (§6.1).

| A | B | Overlap |
|---|---|---|
| `foo` | `foo` | yes |
| `foo/` | `foo/bar.ts` | yes |
| `foo` | `foo/bar.ts` | yes |
| `foo` | `foo-bar` | **no** |
| `foo/` | `foobar/x` | **no** |
| `src/a.ts` | `src/b.ts` | no |
| `foo/` | `FOO/bar` | yes iff `core.ignorecase` |
| `./foo/` | `foo` | yes |

### 7.2 Single-machine (`shared-tree`, `worktrees`): compare-and-swap under the lock

1. Acquire the lock (§6.10).
2. Refuse if a claim file for me exists, or any existing claim conflicts
   (§7.1), or any **dirty or staged path overlaps** the requested paths —
   in `shared-tree` from `git status`, in `worktrees` from `git status` run in
   every worktree listed by `git worktree list`. Name the paths. Unclaimed
   dirty work is presumed to be another agent's (or the remains of a crashed
   finish) until the user says otherwise; this includes the caller's own
   leftovers.
3. Write my claim file (temp + rename).
4. Release the lock. The claim is **Held** — no commit, no verify step. The
   lock makes check-and-write atomic, so there is no Pending state and no
   race to resolve.

Claims live in the common dir, so they're visible to every worktree without
scanning, never enter any branch, and can't leak through merges.

### 7.3 Clones: publish-then-verify

States: **Idle** → **Pending** (committed locally) → **Held** → Idle.

1. **Preconditions.** No claim file for me. Fetch and fast-forward the
   integration branch; refuse if it can't fast-forward. Refuse if I have
   unpushed commits — publishing the claim would push them too.
2. **Pre-check.** Refuse if any claim in `.agents/claims/` conflicts.
3. **Write + commit** my claim file only (pathspec).
4. **Publish.** Push. On rejection: `pull --rebase` (claim files have one
   writer each, so they conflict only if a reaper deleted yours — §6.8;
   ledger conflicts per §6.12), push again; up to five attempts, then stop
   and report.
5. **Verify.** Re-read all claims. If a conflicting claim has precedence —
   its **creating commit** (the most recent commit that added that file) comes
   earlier on the integration branch's first-parent history — **withdraw**:
   delete my file, commit `chore(claims): <agent> withdraws <task>`, push,
   report which claim won. Otherwise **Held**.

A local Pending claim is visible only to its owner, so an agent that dies
before pushing blocks no one.

### 7.4 Commit classes and publication

- A **coordination commit** contains only claim files and ledger files, and
  has no unpushed commits beneath it. It is always pushed immediately
  (clones), regardless of `PUSH_POLICY`.
- Every other commit is a **work commit** and follows `PUSH_POLICY`. A
  coordination-only commit that sits on unpushed work waits with that work.
- `finish` rides in the closing work commit. Under `ask`, the claim stays
  visibly Held to other clones until the user approves that push. This is
  intended: releasing a claim before its work is published would let another
  agent claim paths whose latest state it cannot see.

### 7.5 Liveness and staleness

A claim is `STALE — reapable` when the `touched:` the judging agent can see is
older than `STALE_CLAIM_HOURS`. What it can see depends on topology:

| Topology | What updates visible `touched:` | Rule |
|---|---|---|
| shared-tree, worktrees | every `commit` and `touch`, written to the shared claim file instantly | stale rule applies as written |
| clones, `PUSH_POLICY=auto` | every work commit (pushed) and `touch` (coordination) | stale rule applies, judged after a fetch |
| clones, `PUSH_POLICY=ask` | only what has been pushed; a claim owner with unpushed work **cannot** publish a heartbeat (a `touch` commit would sit on the unpushed work, §7.4) | label `liveness unknown`; reap only on the user's instruction |

Agents doing long work without commits SHOULD `touch` at least every
`STALE_CLAIM_HOURS / 2`.

## 8. Cross-platform requirements

- **Paths.** `\` → `/`, strip any number of leading `./`, collapse `//`.
  Never strip leading dots character-wise (`.github/` must survive).
- **Case.** `core.ignorecase` (§6.3).
- **Encoding.** UTF-8 **without BOM**; Windows PowerShell 5.1 defaults to
  UTF-16 or BOM — use explicit APIs or require PowerShell 7+.
- **Line endings.** Write `\n`; tolerate `\r\n`; `.gitattributes` forces LF.
- **Time.** UTC `YYYY-MM-DDTHH:MMZ`; dates `YYYY-MM-DD`.
- **Atomic writes.** Temp file in the same directory, then rename.
- **Hooks.** `#!/bin/sh`, LF, executable bit recorded in git
  (`git update-index --chmod=+x`).
- **Invocation.** Git commands as argument lists, never a shell string.
- **Exit codes.** 0 success; 1 refused/problem; messages on stderr.

## 9. Acceptance scenarios

Run in scratch setups matching the topology (clones: two clones of a bare
local remote; worktrees: two worktrees of one repo). Record pass / fail /
not-applicable with the reason. At Tier 0, perform them by hand. Scratch
simulations may cover every scenario except X1.

**All tiers**
- A1. `AGENTS.md` and shims exist; shims hold only import/pointer, identity,
  agent-specific notes.
- A2. Ledgers match the heading allowlist; no intro line starts with `## `.
- A3. No `{{…}}` in installed files (the `.agents/blueprint/` copy is
  exempt); dates valid; config parses per §6.2.
- A4. `git check-attr merge -- <path>` reports `union` for `STATUS.md` and
  `.agents/archive/recent-activity.md`, and `unspecified` for `TODO.md`,
  `CHANGELOG.md`, and `.agents/archive/TODO-done.md`. (Check with git, not by
  reading the file: attributes resolve per attribute, last matching line
  wins.)
- A5. `.agents/archive/README` is tracked; in clones, `.agents/claims/README`
  is tracked. No helper hard-codes a claims path; all use §6.1.
- A6. On a fresh install, before any claim or rotation, `lint` exits zero.
- A7. `git config core.hooksPath` is `.githooks` (or the hook manager runs
  the tracked hook). Editing `.githooks/pre-commit` changes what the next
  commit runs, with no re-install.

**Tier ≥1**
- G1. `git add -f data/a/b.txt` under a forbidden directory → blocked.
- G2. Nested `.env` blocked; `.env.example` beside it allowed.
- G3. *(Only where `core.ignorecase` is true.)* `DATA/x` blocked.
- G4. Blocking works for a pathspec commit.
- G5. Hook uses only `sh` builtins, git, `tr`, `grep`, `mktemp`; on Windows,
  blocks through Git for Windows.
- G6. A forbidden file tracked before the hook existed → audit fails, names it.
- G7. Pattern file with CRLF endings still blocks.
- G8. An invalid pattern (`(unclosed`) → every commit refused, and `lint`
  exits non-zero naming the pattern file (fail closed everywhere).
- G9. Hook with `set -e` added still allows clean commits and blocks bad ones.

**All tiers — real agents**
- X1. *Cross-agent smoke test.* Run by the actual agents, each in its own
  runtime and sandbox — not simulated by one agent running two processes.
  Agent A claims a small path and holds it. Agent B runs **status** and sees
  A's claim; B's overlapping claim is refused naming A; B claims a disjoint
  path, commits a brand-new file, and finishes. A runs **lint** and
  **status**: both clean, B's Recent activity line present. A then finishes.
  Repeat with roles swapped. At Tier 0/1, perform it by hand. X1 can't be
  N/A: if an agent can't run it (for example its sandbox refuses writes to
  the common dir), record FAIL with the error and add a blocker TODO.

**Tier 2 — claims**
- H1. A claims `src/`; B claims `src/parse.x` → refused naming A; B claims
  `docs/guide.md` → Held.
- H2. Every §7.1 row as unit tests of the overlap function.
- H3. Same agent claims twice → refused.
- H4. *Single-machine race:* two overlapping `claim` calls started at the same
  moment → exactly one Held, the other refused.
- H5. *Worktrees:* a claim made in worktree 1 blocks an overlapping claim in
  worktree 2; `git ls-files` on both branches shows no claim files.
- H6. *Clones race:* both clones claim overlapping paths from the same base;
  the second push is rejected, rebases cleanly, pushes, verifies, withdraws.
- H7. *Clones:* claim refused with unpushed commits; refused when the
  integration branch can't fast-forward.
- H8. Two claims with `todo:` values differing only in case/whitespace →
  second refused; default task skips claimed items.
- H9. Task `Fix "café" bug & tidy` round-trips claim → finish unchanged.
- H9a. *Single-machine:* `claim` for paths that overlap an unclaimed dirty or
  staged file → refused, naming it (in `worktrees`, a dirty file in the other
  worktree counts).
- H9b. Fresh repo with no claims directory: `status` and `lint` report no
  claims; the first `claim` creates the directory.

**Tier 2 — lifecycle**
- H10. Shared index: A stages `src/a`; B commits `docs/guide.md` → B's commit
  has only B's paths (plus B's claim file in clones); `src/a` still staged.
- H11. `commit` refuses `.`, a directory (claim-root message), a forbidden
  path, a nonexistent untracked path, and a reaped caller; allows deleting a
  tracked file; commits a brand-new, never-tracked file; updates `touched:`.
- H12. `commit` outside the claim → warning, proceeds.
- H13. `block` → `blocker:` in claim; blocker item atop `Next`.
- H14. `finish` over budget → oldest archived; items one line each.
- H14a. *Single-machine finish window:* while A's `finish` holds the lock
  and commits, B's overlapping `claim` waits; after A's commit succeeds, B's
  claim proceeds and sees A's work committed. A `finish` whose commit the
  hook refuses → A's claim still exists afterwards.
- H15. `reap`: fresh claim → refused; stale with dirty files in its paths →
  stops and lists them; stale and clean → removed, Recent activity + Resume
  TODO added; the reaped agent's next `commit` → refused.
- H16. *Clones + `ask`:* A makes local work commits for longer than the stale
  window (fake the clock); B fetches → `liveness unknown`, reap refused
  without user instruction. Same with `auto` → A's pushed commits keep it
  `live`.
- H17. *Clones:* under `ask`, A's closing work commit (with `finish`) is not
  pushed; B still sees A's claim Held.
- H17a. *Clones:* B reaps A's stale claim and pushes; A then commits (which
  updates its claim file) and pulls → modify/delete conflict on A's claim
  file; resolution keeps A's work commits, deletes the claim; A's next
  `commit` is refused as reaped.
- H17b. *Clones + `ask`, unpushed work:* `touch` commits but does not push,
  and says why.
- H18. `done`: ambiguous → refused; match only in a continuation line → moved
  intact; item referenced by another agent's claim → refused.
- H19. `rotate` twice with tiny budgets → second run changes nothing; one
  pointer; no blank-line runs.

**Tier 2 — concurrency on ledgers**
- H20. *Lock, one machine:* two `finish` calls at once → both items present.
  Lock held by a live owner → second caller waits, then succeeds. Lock older
  than stale, two concurrent breakers → exactly one breaks it. Lock held past
  `LOCK_WAIT_SECONDS` → refusal naming the owner. Every exit path from an
  operation that holds the lock — success, refusal (e.g. a claim refused on
  overlap, a `finish` whose commit the hook refuses), or error — leaves no
  lock behind; the next operation acquires it immediately.
- H21. *Clones, union file:* concurrent one-line Recent activity prepends →
  both intact.
- H22. *Clones, non-union file:* concurrent multi-line CHANGELOG prepends →
  a conflict surfaces (not a silent splice); resolution per §6.12 keeps both
  entries whole. Rotate on one side vs a prepend on the other → merges
  cleanly, no archived entry resurrected, one pointer line.
- (H21 and H22 test merge drivers, which behave the same whatever the
  topology. On a single-machine topology, run them as two local branches
  merged into one checkout.)
- H23. `lint` flags merge markers, duplicated heading, heading with trailing
  whitespace, `claude.claim` containing `agent: codex`, a `todo:` with no
  match, a two-line Recent activity item; warns on a stale claim.

## 10. Handoff

Report briefly: survey findings (agents, topology, branching, platforms,
runtime); tier and why; files created or merged, flagging `.new` files;
acceptance results including not-applicable rows and why; deferred work as
TODO items; the once-per-clone setup step if any; the per-agent write-access
results from §3.10. The implementation is not complete until X1 has passed
for every agent — if it couldn't be run yet, say so plainly and leave a TODO
item for it at the top of `Next`. Then finish your claim, add the CHANGELOG
entry, and commit by exact paths.
