# Sharing Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** An admin's hide of a shared copy sticks, and Publish needs content viewers can see.

**Architecture:** One new migration re-creates `check_hidden_copy_delete`, `share_presentation` and
`has_publishable_content`; the app mirrors the content rule and shows the new refusals.

**Tech Stack:** Postgres (Supabase, local Docker), Next.js server actions, zod.

**Spec:** `docs/superpowers/specs/2026-11-15-sharing-review-fixes-design.md`

## Global Constraints

- New migration: `supabase/migrations/20261231001500_sharing_fixes.sql`, functions copied from their NEWEST
  version in `supabase/schema.sql`, then changed.
- Tests only on local Docker (`npm run test:sql`), then `npm run db:snapshot`.
- New refusal code `QMHID`, message in `REFUSALS`.

## Review Focus

- Account deletion (no logged-in user) of a teacher with a hidden copy must still work → `account_delete.sql` still passes.
- Admin hide / show of a copy still works → asserted in the new test.
- Bulk delete with one hidden-copy original: whole delete refused, user sees the QMHID message.
- A text box whose html is `<p></p>` or `<p>&nbsp;</p>` doesn't count; `<p>Hi</p>` does.
- A slide with `"hidden": true` and a question doesn't count.

---

### Task 1: Database fixes (findings 1, 2, chain, 6, 8)

**Files:** Create `supabase/migrations/20261231001500_sharing_fixes.sql`, `supabase/tests/sharing_fixes.sql`.

- [ ] Write `sharing_fixes.sql`: teacher deletes an original with a hidden copy → `QMHID`; admin deletes it → ok;
  share after the copy is hidden → refused; A → B → C chain with A's copy hidden, share C → refused; only a hidden
  slide with a question → `QMPUB`; only an empty text box → `QMPUB`; text box with text → ok; every `presentations`
  column is copied except the list (id, owner_id kept equal, created_at, updated_at, shared_from, shared_at,
  is_published, hidden_at, copied_from, author_id, tags_text, search_text); admin hide then show of a copy works.
- [ ] Run `npm run test:sql -- sharing_fixes.sql`: FAIL.
- [ ] Write the migration.
- [ ] Run `npm run test:sql`: all PASS. Then `npm run db:snapshot`.

### Task 2: App (findings 6, 10, QMHID on delete, 3)

**Files:** `src/lib/schema.ts` (`hasSlideContent`), `src/lib/schema.test.ts`, `src/lib/sharing.ts` (`refused`),
`src/lib/presentations.ts` (`REFUSALS.QMHID`), `src/app/actions.ts` (`removePresentations` →
`Promise<{ ok: true } | { ok: false; message?: string }>`), its 4 callers,
`supabase/migrations/20261123000000_shared_copy.sql` (warning comment only), notes in `src/lib/CLAUDE.md` /
`supabase/migrations/CLAUDE.md`.

- [ ] Failing `npm test` cases for `publishableSchema` (hidden slide, empty text box, text box with text).
- [ ] Change `hasSlideContent`; `npm test` passes.
- [ ] `refused()`, `removePresentations` and callers; warning comment; notes.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`; commit.
