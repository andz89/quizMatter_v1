# Text Limits While Typing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor refuses a change that would push a text past the limit zod checks on save.

**Architecture:** One small Tiptap extension (`TextLimit`, a ProseMirror `filterTransaction`) added by
`useCanvasTextEditor`, so the question, answer choices, text boxes and table cells all get it. The slide name input
gets `maxLength`.

**Tech Stack:** Tiptap 3 (`@tiptap/core`, `@tiptap/pm`), sonner, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-17-text-limits-while-typing-design.md`

## Global Constraints

- Limits: plain text 5,000 (`PLAIN_TEXT_MAX`), HTML 50,000 (`HTML_MAX`), both from `schema.ts`.
- Message: "This text is at its limit. Shorten it to add more." (toast id `text-limit`).
- No new package.

## Review Focus

- Undo / "Clear text" / outside `setContent` on text over a limit must still apply (`preventUpdate` passes).
- Deleting text that is already over a limit must still work (only a change that makes it longer is refused).
- A huge paste is refused whole, with the toast; the text stays as it was.
- The format toolbar adding HTML (color on every word) is stopped by the HTML limit, not the text limit.
- Many refusals in a row show one toast, not a stack.

---

### Task 1: The limit while typing

**Files:**
- Create: `src/lib/textLimit.ts`
- Modify: `src/lib/schema.ts:94-95` (export `PLAIN_TEXT_MAX`, `HTML_MAX`), `src/lib/useCanvasTextEditor.ts`,
  `src/components/editor/EditableText.tsx`, `src/components/editor/SlideToolbar.tsx:72`
- Test: `e2e/text-limits.mjs`
- Notes: `src/components/editor/CLAUDE.md`, `src/lib/CLAUDE.md`, `e2e/CLAUDE.md`

**Interfaces:**
- Produces: `TextLimit` (Tiptap `Extension`, options `{ maxText: number | null; maxHtml: number; onRefused: () => void }`),
  `TEXT_LIMIT_MESSAGE`; `useCanvasTextEditor({ …, hasTextLimit?: boolean })`.

- [x] **Step 1: Write the failing e2e test** `e2e/text-limits.mjs`: a choice slide (question "Q", options A–D) and a
  text box ("Box"). Checks: pasting 5,001 characters into the question leaves "Q" and shows the toast; pasting up to 5,000
  goes in; typing past it is refused; Backspace still works; pasting 5,001 into answer choice A leaves "A"; pasting 50,001 into the text box
  leaves "Box"; pasting 10,000 "&" into it (HTML 50,000+, text only 10,000) is refused; 9,000 "&" goes in; two
  refusals show one toast; Ctrl+S saves the question at 4,999 characters; the slide name input has `maxlength` 5000.
- [x] **Step 2: Run it:** `node e2e/text-limits.mjs`. Expected: FAILs on the refusals.
- [x] **Step 3: Implement** `TextLimit` in `src/lib/textLimit.ts`; `useCanvasTextEditor` adds it from two module-level
  extension lists; `EditableText` passes `hasTextLimit: true`; slide name `maxLength={PLAIN_TEXT_MAX}`.
- [x] **Step 4: Run** `node e2e/text-limits.mjs` (all PASS), `node e2e/table-element.mjs`, `npx tsc --noEmit`,
  `npm run lint`, `npm test`.
- [x] **Step 5: Notes and commit** on `dev`.
