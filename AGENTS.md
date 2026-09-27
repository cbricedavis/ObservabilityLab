# AGENTS.md — ObservabilityLab

The single rulebook for every agent in this repo. Agents that don't read this
file natively load it through a shim (`CLAUDE.md`) that only adds identity.
**Change rules here, never in a shim.**

---

## 1. Project

<!-- Filled in by the implementing agent from its survey. Keep it to facts an
     agent can't get from reading the code. -->

**What this is:** ObservabilityLab is a compact, self-hosted observability
platform (metrics, logs, distributed traces, synthetic HTTP checks, monitors,
incidents, dashboards) inspired by Datadog/Splunk Observability/New
Relic/Grafana Cloud. It is deliberately built through parallel multi-agent
development so it can stress-test *this* collaboration framework — schema
propagation, cross-agent change coordination, and conflict detection are
first-class goals, not side effects. Full product spec:
`ObservabilityLab_Implementation_Spec_v1.0.md` (v1.0, implementation-ready) —
read it before starting any product work; it is the source of truth for
everything below and for anything this file doesn't cover.

**Facts not obvious from the code:**

- There is no implementation yet. The repo currently holds only the product
  spec and this collaboration framework. Product work starts at Milestone 0
  (spec §38): repo structure, shared contracts, Docker Compose skeleton,
  storage instances, ADRs, CI, linting, test framework.
- The spec's §31 "Agent Workstreams" describes twelve conceptual roles
  (Architecture, Metrics, Logs, Tracing, Synthetics, Query, Monitors/
  Incidents, Frontend, Demo App, Platform, QA/Integration, Adversarial
  Reviewer). Only two real agent identities exist here (`claude`, `codex`).
  A workstream is owned by whichever agent currently holds a claim on its
  paths, not fixed per identity for the life of the project — rotate through
  TODO.md items rather than permanently splitting workstreams by name.
- Shared-package ownership (spec §32) is a real constraint, not a suggestion:
  `packages/telemetry-schema`, `packages/query-model`, `packages/
  api-contracts`, and `packages/shared` each need a declared owner, and
  changing one you don't own requires a proposed contract change, documented
  consumers, architectural approval, and updated contract tests — before the
  code change, not after.
- The eight ADRs in spec §34 (storage engines, telemetry envelope, tagging
  model, query syntax, rollup strategy, monitor state semantics, OTel
  integration, shared-package ownership) MUST exist; treat missing ones as
  blocking for the area they cover, not optional documentation.
- Cross-cutting changes need a change record (spec §35, template included)
  *before* any affected agent starts on them. Track it as a TODO item and
  reference it from the CHANGELOG entry that eventually closes it. No
  cross-cutting change is complete until every affected agent has
  acknowledged it.
- Spec §37's ownership question (does Metrics or Query own aggregation
  semantics?) is an intentionally unresolved ambiguity, not an oversight.
  Don't silently pick a side in code — the recommended split (Query owns
  syntax/logical semantics; Metrics owns physical execution) MUST be written
  up as its own ADR before either agent implements aggregation.
- Spec §36 lists five deliberate "stress test" changes (tag normalization,
  multi-tenancy, metric retention, query grammar expansion, trace/log
  correlation). They land only after the baseline system is functional —
  don't pull them into early-milestone work.
- Spec §3's non-goals (no HA, no clustering, no k8s requirement, no ML
  anomaly detection, no RUM, no billing, no advanced RBAC, no mobile, no
  commercial-grade auth, etc.) are real scope fences for Version 1.

**Where work runs:** one local machine, one working tree (`shared-tree`
topology — see §2). Once the product exists, `docker compose up --build` runs
the whole platform locally; nothing in this framework runs it automatically.

**Never commit:** anything matching `.agents/forbidden-paths`. To protect a new
kind of path, add a pattern there (see its header) — every guard reads that
file.

## 2. Commands

Tier: **2 (Helpers)**. Topology: **shared-tree**. Integration branch:
**`main`**. Each step below names an operation; this table says how to
perform it here.

All helper commands live in `.agents/bin/agents.mjs`, a dependency-free Node
script (needs only Node, already required on this machine; no package.json,
so it commits this repo to nothing about the product's own stack). Identity
comes from the `AGENT` environment variable; if unset, the tool — like every
agent that only reads this file — assumes you are **codex**. `claude` MUST set
`AGENT=claude` (its shim says so).

| Operation | How |
|---|---|
| status | `node .agents/bin/agents.mjs status` |
| claim | `AGENT=<you> node .agents/bin/agents.mjs claim "<task>" "<todo first line or ->" <path> [path...]` |
| touch | `AGENT=<you> node .agents/bin/agents.mjs touch` |
| commit | `AGENT=<you> node .agents/bin/agents.mjs commit "<message>" -- <path> [path...]` |
| block | `AGENT=<you> node .agents/bin/agents.mjs block "<note>"` |
| finish | `AGENT=<you> node .agents/bin/agents.mjs finish "<outcome>" ["<refs>"] -- <path> [path...]` |
| reap | `AGENT=<you> node .agents/bin/agents.mjs reap <target-agent> "<reason>"` |
| done | `AGENT=<you> node .agents/bin/agents.mjs done "<match text>" ["<note>"]` |
| rotate | `AGENT=<you> node .agents/bin/agents.mjs rotate` |
| lint | `node .agents/bin/agents.mjs lint` |
| resource probes | `node .agents/bin/agents.mjs status` (Resource probes section; no resource kinds registered yet — see TODO.md) |
| one-time setup per clone | `node .agents/bin/agents.mjs setup` (installs the pre-commit guard into `.git/hooks/`; idempotent) |

"By hand" means following the claim protocol and file formats in
`.agents/blueprint/BLUEPRINT.md` §6–§7 exactly; other agents and tools parse
what you write.

## 3. Identity

- Your name comes from your shim. If you loaded only this file, you are
  **`codex`**. Known agents: claude, codex.
- A second concurrent session of the same agent uses a suffixed name
  (`claude-wt2`). One name = one claim at a time.
- Anything you launch that outlives your session (cloud workers, containers,
  preview deploys, background jobs) carries the tag `agent:<your-name>` and a
  **run-unique** state/lock path, never a shared default.

## 4. Where state lives

| Path | Holds | Who writes |
|---|---|---|
| `<agent>.claim` in the `agent-collab/claims/` folder inside `git rev-parse --git-common-dir` | that agent's current claim: task, TODO item, paths, `touched` | only its owner (or a reaper) |
| `STATUS.md` | shared resources, last ~10 outcomes (one line each) | anyone, append-style |
| `TODO.md` | goal, `Next`, `Later`, recent `Done` | anyone |
| `CHANGELOG.md` | user-visible and contract-level changes | anyone, append-style |
| `.agents/archive/` | rotated history | rotate / finish |

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
   directories you expect to touch. The claim is yours as soon as the command
   succeeds. While your claim exists, don't edit the first line of the TODO
   item it references.

**Work**
5. One logical item at a time. Scope grew? Add a TODO item rather than
   silently widening the claim. Need a path outside your claim? Finish and
   re-claim so others can see it.
6. Commit with **commit**, naming exact files. Every commit refreshes your
   claim's `touched:` time; on long stretches without commits, **touch** at
   least every 24/2 hours.
7. If your claim file has disappeared — or a rebase reports a modify/delete
   conflict on it — you were reaped: accept the deletion, keep your work
   commits, don't recreate the file, and re-claim before doing anything else.

**Finish** — in the same commit as the last piece of work
8. On this machine `finish` makes the closing commit itself, so pass it your
   paths instead of committing separately. **finish** your claim with a
   one-line outcome and references to earlier commits and run IDs. **done**
   the TODO item with any limitations. Add a CHANGELOG entry if anything
   user-visible or contract-level changed. Commit the work, the ledgers, and
   the claim-file deletion together. (A commit can't contain its own hash;
   the closing commit is the record.) The claim is released for other agents
   as soon as that commit succeeds — there is no publish/verify step on one
   machine.

**Blocked**
9. **block** with the error, link, or run ID, and publish it. Keep the claim.

**When another agent seems dead**
10. **reap** only claims that **status** labels `STALE — reapable`; anything
    else only on the user's instruction. Every commit and touch updates the
    shared claim file instantly, so the staleness rule (BLUEPRINT §7.5)
    applies exactly as written — there's no "liveness unknown" case on one
    machine. If the dead agent left uncommitted changes inside its claimed
    paths, stop and ask the user — never modify, stash, or discard another
    agent's work.

**Before your final response**
11. Confirm your claim is finished or intentionally held, and the ledgers
    reflect the work (or say why it was too small to log).

## 6. Commit discipline

- Small commits, one idea each. Conventional prefixes: `feat` `fix` `chore`
  `docs` `refactor` `test`, scoped when useful: `fix(parser): …`.
- **Push policy for work commits: `auto`.** Push right after every commit
  that succeeds and includes at least one non-ledger path. A commit
  containing only claim files and ledgers is a *coordination* commit; on this
  single-machine topology, claims are never committed at all (they live
  outside git, in the common dir), so in practice every commit here is a work
  commit and gets pushed immediately to `origin`.
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
