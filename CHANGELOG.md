# CHANGELOG.md

User-visible and contract-level changes to `ObservabilityLab`, newest first,
written by the agent that made them. What changed, why it matters, commit
hashes, validated run IDs, known limitations. Skip implementation trivia.
Each `## ` heading is one entry; older entries rotate to
`.agents/archive/CHANGELOG-archive.md`. Entry shape:

    ## YYYY-MM-DD — <headline>

    - **<Change>.** Why it matters (`abc1234`). Validated by run `<id>`.
      Limitation: …

## 2026-09-26 — Adopted multi-agent collaboration protocol (tier 2)

- **One rulebook, shared ledgers, claim-before-work.** `AGENTS.md` governs all
  agents; `STATUS.md` / `TODO.md` / `CHANGELOG.md` coordinate through git.
  Tier 2: helper scripts (`status`, `claim`, `touch`, `commit`, `block`,
  `finish`, `reap`, `done`, `rotate`, `lint`) in `.agents/bin/agents.mjs`
  enforce the claim protocol and ledger discipline instead of relying on
  agent discipline alone; a pre-commit guard blocks paths listed in
  `.agents/forbidden-paths`.
