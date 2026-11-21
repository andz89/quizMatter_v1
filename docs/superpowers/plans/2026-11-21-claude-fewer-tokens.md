# Claude Fewer Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude can finish a checked draft without resending its slides, and the format text is smaller.

**Architecture:** `send_presentation` gets a no-`slides` branch that reads the draft (`getDraft`) and stores it again
without `checking` (`replaceDraft`). `getClaudeFormat` writes the JSON Schema on one line.

**Tech Stack:** Next.js API route (MCP SDK), zod, Cloudflare D1, Playwright-free e2e script (`fetch`).

**Spec:** `docs/superpowers/specs/2026-11-21-claude-fewer-tokens-design.md`

## Global Constraints

- Every send with slides still returns the layout report.
- No change to the draft's stored shape; no migration.
- Notes in `src/pages/api/CLAUDE.md` updated in the same commit.

## Review Focus

- A draftId the user already saved (gone from D1) → clear error telling Claude to send the slides again.
- No slides with `final: false` → error (there is nothing to check).
- No slides, no draftId → error.
- `details` sent with no slides → they replace the draft's details (title fix keeps working).
- Old chats sending slides as before → unchanged behavior.

---

### Task 1: Finish by draftId + smaller format

**Files:**
- Modify: `src/pages/api/mcp.ts` (`send_presentation` loop, ~line 261)
- Modify: `src/lib/importPresentation.ts` (`getClaudeFormat`, "Checking before the final version" rules)
- Modify: `src/pages/api/CLAUDE.md`
- Create: `e2e/claude-finish-draft.mjs`

- [ ] **Step 1: Write `e2e/claude-finish-draft.mjs`** (same `callTool` helper as `e2e/claude-number-fixes.mjs`):
  - check send of 2 choice slides, `final: false` → not error, text has `Draft id: <uuid>`.
  - `send_presentation({ final: true, draftId })` with no slides → not error, text contains `/presentation/new?draft=<id>` and `2 slides`.
  - `send_presentation({ final: false, draftId })` no slides → `isError`.
  - `send_presentation({ final: true })` no slides, no draftId → `isError`.
  - `send_presentation({ final: true, draftId: randomUUID() })` no slides → `isError`, text mentions sending the slides again.
  - format text has no `"\n  "` inside the schema part (one line).
- [ ] **Step 2: Run it** (`npm run e2e:dev`, then `node e2e/claude-finish-draft.mjs`) → FAIL (slides required).
- [ ] **Step 3: Implement.** `slides: z.array(z.unknown()).optional()`; no-slides branch before `buildSlides`:
  errors as above; found → `replaceDraft(draftId, { details: details ?? draft.details, slides: draft.slides }, userId)`;
  `false` → same "gone" error; reply = the final intro with the link, no report. `details` input loses its `= {}`
  default only in the no-slides branch. `getClaudeFormat`: `JSON.stringify(schema)` without indent. Rules + tool
  description: one line each about finishing without slides.
- [ ] **Step 4: Run the test again** → PASS; run `e2e/claude-number-fixes.mjs` too (its format regex must still match).
- [ ] **Step 5: `npx tsc --noEmit`, `npm run lint`, `npm test`**, update notes, commit on `dev`.
