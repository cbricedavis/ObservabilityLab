# CHANGELOG.md

User-visible and contract-level changes to `ObservabilityLab`, newest first,
written by the agent that made them. What changed, why it matters, commit
hashes, validated run IDs, known limitations. Skip implementation trivia.
Each `## ` heading is one entry; older entries rotate to
`.agents/archive/CHANGELOG-archive.md`. Entry shape:

    ## YYYY-MM-DD — <headline>

    - **<Change>.** Why it matters (`abc1234`). Validated by run `<id>`.
      Limitation: …

## 2026-09-27 — Updated to the amended agent-collab blueprint

- **Refreshed `.agents/blueprint/` from `/Users/collindavis/Documents/DataProjects/agent-collab`.**
  Carries the amendments covering X1 (cross-agent smoke test), hook install
  by reference, the relaxed single-machine runtime rule, and lock/lint/H11
  test coverage. `agent-collab` is not a git repo, so there's no commit hash
  to record — the copy is a plain snapshot.
- **`setup` now installs the guard via `git config core.hooksPath .githooks`
  instead of copying into `.git/hooks/`.** Per BLUEPRINT §6.4: a copy goes
  stale silently when the tracked hook changes; a config pointer doesn't.
  Re-ran `setup` here. Found and fixed a real gap while verifying A7:
  `.githooks/pre-commit` had never actually been marked executable (mode
  `100644` in the index), so `core.hooksPath` alone silently no-opped it —
  git only printed a hint, nothing blocked. Fixed via
  `git update-index --chmod=+x`.
- **`lint` now flags an active hook that isn't the tracked one** (BLUEPRINT
  §6.11): errors if `core.hooksPath` isn't `.githooks` and no hook manager
  is registered.
- **`AGENTS.md` §1 now names the collaboration tooling's runtime explicitly**
  (dependency-free Node, chosen independently of the product's own stack),
  per the relaxed single-machine runtime rule (BLUEPRINT §4 option 3).
- Re-verified H11 (new-file commit), H20 (no lock leak on a refused claim or
  a hook-refused finish), and G8 (lint fails closed on an invalid pattern)
  against the current helpers — all still pass; no further code changes
  needed for those three.
- Added a TODO item for X1 (BLUEPRINT §9): the cross-agent smoke test needs
  Codex and Claude to actually run it in their own runtimes, which this
  session didn't attempt.

## 2026-09-26 — Adopted multi-agent collaboration protocol (tier 2)

- **One rulebook, shared ledgers, claim-before-work.** `AGENTS.md` governs all
  agents; `STATUS.md` / `TODO.md` / `CHANGELOG.md` coordinate through git.
  Tier 2: helper scripts (`status`, `claim`, `touch`, `commit`, `block`,
  `finish`, `reap`, `done`, `rotate`, `lint`) in `.agents/bin/agents.mjs`
  enforce the claim protocol and ledger discipline instead of relying on
  agent discipline alone; a pre-commit guard blocks paths listed in
  `.agents/forbidden-paths`.
