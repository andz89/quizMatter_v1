# Public Home, Sitemap, Titles and h1s Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logged-out visitors get a public home at `/`, Google gets a sitemap of QuizMatter lessons, and every page has its own title and one `<h1>`.

**Architecture:** Two anon-callable `security definer` functions (`public_lessons`, `public_lesson_ids`). The proxy rewrites a logged-out `/` to `/welcome` (never served at its own address). `sitemap.ts` pages through `public_lesson_ids`. Titles via a root title template.

**Tech Stack:** Next.js 16 metadata files and `NextResponse.rewrite`, Supabase SQL, Playwright, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-20-public-home-and-seo-design.md`

## Global Constraints

- Logged-in `/` and every logged-in page behave exactly as today (only the tab title changes).
- Part 1 rules hold for anything anon reads: published and not hidden only, no display names, no answers (`correctOptionId` null, no `correctAnswer`, no `containerId` "answer" elements), no YouTube cover (`showVideoCover={false}`).
- Hero copy: h1 "Build presentations with quizzes built in"; line "QuizMatter helps teachers make bright, simple lessons and quizzes that kids love to play."; buttons "Sign up free", "Log in"; section "Ready-made lessons from QuizMatter" (8 newest).
- Title template `%s · QuizMatter`; titles exactly as the spec's table.
- `public_lessons(p_limit)`: 1–50 else `22023`. Sitemap: 1,000 per read, 50,000 max.
- Docker only for DB tests; design-system classes only.

## Review Focus

- `/welcome` reached directly (logged in or out) must redirect to `/` (Task 3 test).
- A logged-in teacher at `/` must get the normal home, not the public one (Task 3 test).
- A QuizMatter lesson later hidden disappears from the home and sitemap (Task 1 SQL test).
- A teacher's shared copy never appears on the public home or sitemap (Tasks 1 and 3).
- Titles: pages that already wrote "· QuizMatter" must not show it twice (Task 4 check by grep).

---

### Task 1: Database functions

**Files:** Create `supabase/migrations/20261231002400_public_lessons.sql`, `supabase/tests/public_lessons.sql`; modify `supabase/tests/anon_grants.sql`; snapshot.

**Interfaces — Produces:** `public_lessons(p_limit int) returns table (id text, title text, subject text, grades text[], updated_at timestamptz, first_slide jsonb)`; `public_lesson_ids() returns table (id text, updated_at timestamptz)`. Both `execute` to anon, authenticated.

- [ ] Write the SQL test (as anon): lessons L1 (older), L2 (newer, first slide with answers), L3 hidden by an admin, a teacher's shared copy T1, a private lesson draft (from_admin, not published). `public_lessons(10)` = L2, L1 in that order; L2's slide has no answer fields; `public_lessons(1)` = L2 only; `public_lessons(0)` and `(51)` raise `22023`; `public_lesson_ids()` ids = {L2, L1}; no `owner`/`author` columns.
- [ ] Run → fails (function missing).
- [ ] Write the migration. Put the slide-cleaning in one helper, `public_first_slide(p_id text) returns jsonb` (not granted; used by both `public_presentation` and `public_lessons`), so the "first shown slide without its answer" rule is written once; re-create `public_presentation` to call it.
- [ ] Allow both new functions in `anon_grants.sql`. Run both tests + `public_presentation.sql` + `anon_grants.sql` → pass. `npm run db:snapshot`.
- [ ] Commit.

### Task 2: App reads

**Files:** Modify `src/lib/publicPresentation.ts` (+ test).

**Interfaces — Produces:** `type PublicLesson = { id: string; title: string; subject: string; grades: string[]; updatedAt: number; firstSlide: Slide | null }`; `toPublicLessons(rows: unknown): PublicLesson[]` (pure); `getPublicLessons(limit: number): Promise<PublicLesson[]>`; `getPublicLessonIds(): Promise<{ id: string; updatedAt: number }[]>` (pages of 1,000 with `.range`, stops at 50,000 or a short page). The anon client creation moves into one private `anonClient()` shared by all three readers.

- [ ] Test `toPublicLessons`: maps snake_case, parses `updated_at` to ms, a broken slide → null, null input → [].
- [ ] Run → fail. Implement. Run `npm test` → pass. Commit.

### Task 3: Proxy, public home, sitemap, robots

**Files:** Modify `src/lib/publicPaths.ts` (+ test), `src/proxy.ts`, `src/components/LoggedOutBar.tsx` (logo → `/`), `src/components/LoginAbout.tsx` (export `FEATURES`), `src/app/robots.ts`; create `src/app/welcome/page.tsx`, `src/app/welcome/LessonCards.tsx`, `src/app/sitemap.ts`, `e2e/public-home.mjs`; modify `e2e/proxy.mjs`.

- [ ] Unit: `isPublicPreviewPath("/sitemap.xml")` true; `"/welcome"` false.
- [ ] Browser test `e2e/public-home.mjs` per spec Tests (make two lessons as an admin with psql + one teacher copy). Run → fails.
- [ ] Implement: publicPaths; proxy (logged out `/` → `keepSession(NextResponse.rewrite(new URL("/welcome", request.url)))`; any `/welcome` request → redirect `/`, placed so maintenance runs first); welcome page + cards + metadata; sitemap; robots `sitemap`; `LoggedOutBar` logo; `FEATURES`.
- [ ] Run unit + `node e2e/public-home.mjs` + `node e2e/proxy.mjs` + `node e2e/public-preview.mjs` → pass. Look at a phone-width screenshot. Commit.

### Task 4: Titles and the editor's h1

**Files:** `src/app/layout.tsx`, each page in the spec's table (+ `layout.tsx` for `login/`, `login/verify/`, `forgot-password/`), `src/components/editor/Editor.tsx`.

- [ ] Add the checks to `e2e/public-home.mjs`: `/login` title "Log in · QuizMatter"; logged in `/saved` "Saved · QuizMatter", `/` "My presentations · QuizMatter"; `/privacy` "Privacy Policy · QuizMatter" (once); the editor page has exactly one `h1`. Run → fail.
- [ ] Implement the template and titles; preview's title becomes `{ absolute: … }`; the sr-only h1 in `Editor`.
- [ ] `grep -rn "· QuizMatter\"" src/app` shows only absolute titles. Run the tests → pass. Commit.

### Task 5: Notes, policy, final checks

- [ ] Notes and Privacy line per spec. `npx tsc --noEmit`, `npm run lint`, `npm test`, the SQL tests, the browser tests. Commit. Tell the user the deploy order (migration `20261231002400` after `002200`, `002300`).
