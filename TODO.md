# TODO.md

Agents work `Next` top to bottom unless the user redirects. Add an item before
starting anything larger than a one-line fix. Write each item so another agent
could pick it up cold: the outcome, why it matters, and an acceptance check.
Items are `- [ ]` / `- [x]` with continuation lines indented two spaces; `###`
subheadings may group items. TODO items aren't locked: a claim's `todo:`
line references the item it's working on, and the default task for an agent is
the first open `Next` item no claim references.

Completed items move to the top of `Done` as:

    - [x] YYYY-MM-DD: <original text>
      <earlier commits, run IDs, limitations>

Older Done items rotate to `.agents/archive/TODO-done.md`.

## Current Goal

- Stand up the multi-agent collaboration framework (this adoption), then begin
  ObservabilityLab Milestone 0 per `ObservabilityLab_Implementation_Spec_v1.0.md` §38.

## Next

- [ ] **Run X1 (BLUEPRINT §9) with Codex and Claude in their real runtimes.**
    Cross-agent smoke test: each agent claims/commits/finishes in its own
    actual sandbox, not simulated by one agent running two processes. See
    `.agents/blueprint/BLUEPRINT.md` §9 for the exact steps.
- [ ] **Add project-specific forbidden-path patterns.** `.agents/forbidden-paths`
    has only generic secret/log patterns. Once Docker Compose, database data
    volumes, and/or an OTel Collector config (with vendor API keys) exist, add
    real patterns for them (deferred per the user's "wait" decision during
    framework adoption on 2026-09-26).
- [ ] **Write repository documentation.** `README.md`,
    `docs/architecture/overview.md`, `docs/api/`, `docs/adr/`, and the three
    runbooks required by spec §46 don't exist yet.
- [ ] **Start Milestone 0 — Foundation.** Repo structure (spec §8), shared
    contracts (`packages/telemetry-schema`, `packages/query-model`,
    `packages/api-contracts`, `packages/shared`), Docker Compose skeleton,
    storage instances, the eight required ADRs (spec §34), CI, linting, test
    framework. Exit criteria: `docker compose up` starts all infrastructure
    components successfully (spec §38).

## Later

- [ ] Resolve the intentional ownership ambiguity in spec §37 (metric
    aggregation semantics: Metrics vs. Query) with an ADR before either agent
    implements aggregation.
- [ ] Plan the five deliberate stress tests in spec §36 — only after the
    baseline system is functional (Milestones 0–7 complete).

## Done
- [x] 2026-09-27: **Finish adopting the collaboration framework.**
  (no prior commit) — Tier 2 tooling (.agents/bin/agents.mjs), guard, ledgers, and blueprint copy installed; see .agents/blueprint/BLUEPRINT.md §9-§10 for the full acceptance run