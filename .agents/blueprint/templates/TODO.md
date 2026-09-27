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

- {{GOAL}}

## Next

- [ ] **Finish adopting the collaboration framework.** {{ADOPTION_FOLLOWUPS}}

## Later

## Done

None.
