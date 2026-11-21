# Claude's connector: fewer tokens for long presentations

## Why

A 40-item exam made through Claude's connector costs a lot of tokens. Measured on 40 plain choice slides:

- `get_presentation_format` is 126,734 characters: 38,048 of rules, 88,686 of a pretty-printed JSON Schema.
- Claude writes the slides twice: once with `final: false` (the check, which returns the layout report) and
  again with `final: true`, even when the report shows nothing to fix. `slides` is required on every send.

## Goals

1. When the check needs no changes, Claude finishes the draft without writing the slides again.
2. A smaller format text, with the same content.

Non-goals: sending only the changed slides; shared defaults for every slide; cutting rules or schema
descriptions (more mistakes → more full resends would cost more than they save).

Anti-goal: Claude losing the layout report. Every send with slides still returns it.

## Approaches

- **Finish by draftId (picked):** `slides` becomes optional; `final: true` + `draftId` without `slides` turns the
  checked draft into the final one. Reliable: the tool enforces it, not a rule Claude may skip.
- Telling Claude to skip the check for plain question slides: saves the same, but relies on Claude following it
  and loses the report.
- Sending only changed slides: saves more when a few slides need fixes, but more work and more room for mistakes.
  Later, if needed.

## Design

**1. Finish by draftId** (`src/pages/api/mcp.ts`, `send_presentation` and its old names):

- `slides` is optional in the input.
- No `slides`: needs `final: true` and a `draftId`, else an error saying what to send.
  - The owner's draft is read (`getDraft`). Gone (saved by the user, expired, wrong id): an error telling Claude to
    send the slides again (that makes a new draft).
  - Found: it's stored again without the `checking` mark (`replaceDraft`), keeping its slides. `details`, if
    given, replace the draft's (e.g. a fixed title); else the draft's stay. The reply is the final one with the
    link, without a layout report (Claude already has it from the check).
  - Builder's call: an already-final draft finished again just returns its link again (harmless).
- With `slides`: unchanged (checked, report, link).
- The tool description and the rules' "Checking before the final version" say: if the report needs no changes,
  send `final: true` with the `draftId` and leave out `slides`; if anything changed, send the whole fixed version.

**2. Smaller format** (`getClaudeFormat`, `src/lib/importPresentation.ts`): the JSON Schema is written on one line
(`JSON.stringify` without indent): 88,686 → about 49,840 characters. Same content.

No data changes: drafts keep the same shape, no D1 or Supabase migration. Saves are checked as before.

After deploying, the user reconnects the connector in claude.ai and starts a new chat (the tool's inputs changed).

## Tests

`e2e/claude-finish-draft.mjs`: check send → finish by draftId with no slides → link, draft no longer checking;
no slides with `final: false` or without `draftId` → error; an unknown draftId → error.
