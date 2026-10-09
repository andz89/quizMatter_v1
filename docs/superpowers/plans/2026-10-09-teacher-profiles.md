# Teacher Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bio for every teacher, and a profile page any logged-in user can open from a shared link or from the
Publisher / Reviewer names on a presentation page.

**Architecture:** A security-definer function `teacher_profile(id)` returns only public fields; the page
`/teachers/[id]` reads it on the server. The bio is saved with the other personal details (zod first).

**Tech Stack:** Supabase Postgres, Next.js 16 server pages, zod 4, sonner, lucide-react. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-09-teacher-profiles-design.md`

## Global Constraints

- Never return or show the contact number or email on a profile. Admin profiles: only that admin and other admins.
- Bio: plain text, optional, up to 300 characters, checked with zod before saving.
- Design system classes only; the one Spinner / TopLoadingBar / LinkPending; sonner toasts on saves and copy.
- No test runner: SQL checked in a rolled-back transaction; app with `npx tsc --noEmit` + eslint on changed files.

## Review Focus

1. A profile id that isn't a uuid (`/teachers/abc`) → "not found", not a crash.
2. An account with no `user_settings` row yet → profile shows with "QuizMatter teacher" and "No bio yet.", no crash.
3. A teacher opening an admin's id → "not found".
4. Presentation from QuizMatter (admin) → Publisher "QuizMatter" stays plain text, no link to the admin.
5. Copy link when the clipboard is blocked → error toast, nothing breaks.

---

### Task 1: Migration — bio column + `teacher_profile`
**Files:** Create `supabase/migrations/20261110000000_teacher_profiles.sql`.
- [ ] Column `bio` (≤ 300), function per spec (`security definer`, `set search_path = ''`, joins `auth.users` → left join
  `user_settings`, excludes admins unless the caller is that admin or an admin), grants.
- [ ] Check in a rolled-back transaction: own id, another teacher, an admin id as a non-admin, an unknown id. Commit.

### Task 2: Zod, save, account, `profiles.ts`
**Files:** Modify `src/lib/userSettings.ts`, `src/lib/account.ts`; Create `src/lib/profiles.ts`.
- [ ] `BIO_MAX_LENGTH`, `bio` in `profileSchema`, `signUpSchema` from `profileSchema.omit({ bio: true })`, `saveProfile` saves `bio`, `getAccount` reads it.
- [ ] `profiles.ts`: `TeacherProfile`, `loadTeacherProfile`, `profileHref`, `educationLine`.
- [ ] tsc + eslint; commit.

### Task 3: Profile page
**Files:** Create `src/app/teachers/[id]/page.tsx`, `src/app/teachers/[id]/loading.tsx`.
- [ ] Server page per spec (NavBar Home link, card, `notFound()`), loading with TopLoadingBar + Spinner.
- [ ] tsc + eslint; commit.

### Task 4: Links on the presentation page
**Files:** Modify `src/lib/fetchPresentation.ts`, `src/lib/reviewStatus.ts`, `src/app/presentation/[id]/page.tsx`, `src/app/presentation/[id]/PresentationPreview.tsx`.
- [ ] `ownerId` from `fetchPresentation`; `reviewerId` in `Reviewer`; Publisher name and Reviewer names become `Link`s with `LinkPending` (not for "QuizMatter").
- [ ] tsc + eslint; commit.

### Task 5: Account page — bio, view and copy link
**Files:** Modify `src/app/account/AccountForms.tsx`, `src/app/account/page.tsx`.
- [ ] Bio textarea in Personal details; header "View my profile" link + "Copy profile link" button (small client component).
- [ ] tsc + eslint; commit.

### Task 6: Admin pages
**Files:** Modify `src/app/admin/teachers/page.tsx`, `src/app/admin/safety/page.tsx`.
- [ ] Admin → Teachers uses `educationLine`; Safety "Access" gets "Profiles show only public details".
- [ ] tsc + eslint; commit.

### Task 7: Final review
- [ ] Fresh reviewer on the whole branch; fix Critical / Important; merge, run the migration, push (as the user asked before).
