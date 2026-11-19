# Admin → Admins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A view-only Admin → Admins page (super admin only) listing every admin.

**Architecture:** A server page reads `admins`, each admin's auth user (`auth.admin.getUserById`) and their display
name with the secret-key client; a plain `.ts` helper turns them into sorted rows (unit tested). No migration.

**Tech Stack:** Next.js server component, Supabase admin client, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-19-admin-list-design.md`

## Global Constraints

- Super admin only: `getAccount().isSuperAdmin` else `notFound()`; `superOnly: true` in `AdminMenu`.
- Design system classes only (copy Editors' card and pill classes); Lucide icons only; the one `Spinner` / `TopLoadingBar`.
- Notes updated in `src/app/admin/CLAUDE.md` in the same commit.

## Review Focus

- An admin whose auth account is gone (getUserById fails): skip the row, don't crash the page.
- An admin with an unverified factor only: shows "Two-step not set up".
- No display name: show the email alone.
- Super admins sort first, then by email.
- No secret key on the server: the same message Editors shows.

---

### Task 1: Rows helper + page + menu + notes

**Files:**
- Create: `src/app/admin/admins/adminRows.ts`, `src/app/admin/admins/adminRows.test.ts`,
  `src/app/admin/admins/page.tsx`, `src/app/admin/admins/loading.tsx`
- Modify: `src/app/admin/AdminMenu.tsx` (People group), `src/app/admin/CLAUDE.md`

**Interfaces:**
- Produces: `buildAdminRows(admins: { user_id: string; is_super: boolean }[], users: Map<string, User>, names: Map<string, string>, now: number): AdminRow[]`
  with `AdminRow = { id: string; email: string; name: string; isSuper: boolean; hasTwoStep: boolean; meta: string }`
  (`meta` = `joinParts(["Joined …", "Last login …"])`).

- [ ] **Step 1:** Write `adminRows.test.ts`: super first then by email; a verified factor → `hasTwoStep` true, an
  unverified one → false; an admin missing from `users` is left out; meta contains "Joined" and "Last login".
- [ ] **Step 2:** `npm test` → fails (module missing).
- [ ] **Step 3:** Implement `buildAdminRows` in `adminRows.ts`.
- [ ] **Step 4:** `npm test` → passes.
- [ ] **Step 5:** `page.tsx` (secret key check, reads, cards with pills: Super admin `bg-accent-soft text-accent`,
  Admin `bg-bg-page text-text-secondary`, Two-step on `bg-success-soft text-success-strong`, not set up
  `bg-highlight-soft text-highlight-strong`; one intro line: add or remove admins in the Supabase SQL editor),
  `loading.tsx`, the menu item, the notes.
- [ ] **Step 6:** `npx tsc --noEmit`, `npm run lint`, open the page on `npm run e2e:dev` as a super admin.
- [ ] **Step 7:** Commit on `dev`.
