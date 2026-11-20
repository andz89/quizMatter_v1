# Handoff: public pages and SEO (parts 1 and 2), built 2026-11-20

For whoever reviews this work next. It says what was built, where it lives, what was decided and why, what is known to
be missing, and where to start. Read the two specs first; they hold the reasons.

- Part 1 spec: `docs/superpowers/specs/2026-11-20-public-presentation-preview-design.md` (its "As built" and
  "Review fixes" sections at the end record the changes made while building and after the first review).
- Part 2 spec: `docs/superpowers/specs/2026-11-20-public-home-and-seo-design.md`.
- Plans: `docs/superpowers/plans/2026-11-20-public-presentation-preview.md`, `…/2026-11-20-public-home-and-seo.md`.

## What it does, in short

Before: every page but login, sign up, Forgot password, the email link, Privacy and Terms sent logged-out visitors
(and every robot: Google, Facebook's link reader) to `/login`. Now:

1. **Part 1, public preview.** A *published, not hidden* presentation's link (`/presentation/<uuid>`) opens
   for logged-out visitors: the first shown slide, the title as the `<h1>`, the Author, subject · grades · slide
   count, the description, and "Log in to see …" / "Sign up free". Shared links get a QuizMatter **title card**
   picture (not a picture of the slide: the owner chose this). Everything else still goes to login with a real 307.
2. **Part 2, public home and SEO.** Logged-out `/` shows a public home page (served by a proxy rewrite to
   `src/app/welcome`; `/welcome` itself redirects to `/`) with the 8 newest QuizMatter lessons; `/sitemap.xml` lists
   the public pages and every QuizMatter lesson; every page has its own tab title ("Saved · QuizMatter"); sign-in
   steps and Admin are `noindex`; the editor has a screen-reader `<h1>`.

## The owner's decisions (don't undo without asking)

- Link picture = a **title card**, not a screenshot of slide 1 (plain teachers can't upload pictures, on purpose;
  a browser-made snapshot would have opened uploads; a Cloudflare screenshot needs the paid browser product).
- **Every published presentation** has a public preview (teachers' shared copies and QuizMatter lessons), but the
  name shown is **only the Author text** the teacher typed; empty Author = no name (never the display name, which
  sign up makes from the teacher's real full name). QuizMatter lessons with no Author say "QuizMatter".

## Calls I made (check these)

- The **proxy** asks `public_presentation` for a logged-out `/presentation/<uuid>` and redirects (307) when it isn't
  public, because the page streams under `src/app/presentation/loading.tsx` and its own `redirect()` arrived as a 200
  plus a late refresh. Cost: one small read per logged-out visit; the page checks again.
- The link picture's **fonts are base64 in the code** (`src/app/fonts/ogFonts.ts`), not read from files, since a
  Worker can't be relied on to read files (+85 KB). Licenses next to it.
- The link picture is cached **1 hour** (`Cache-Control: public, max-age=3600`); a non-public id's picture is **404
  without drawing** (cheap against random ids; private and unknown look the same).
- **Answers never leave the database for logged-out visitors**: `public_first_slide` empties `correctOptionId`,
  drops `correctAnswer` and the answer box's elements (`containerId` "answer"). Done in SQL because anyone can call
  the functions directly with the public anon key.
- A logged-out visitor's **video slide shows its plain box** (`showVideoCover={false}` through `FluidSlidePreview` →
  `SlideStaticView` → `EmbedSlideView`), so YouTube never sees them.
- The **sitemap lists only QuizMatter lessons**; teachers' shared copies are public by link but never advertised,
  and never on the public home.
- `public_lessons(p_limit)` takes **1–12** (one slide may be 2 MB; caps one call at ~24 MB).
- Admin pages are `noindex` (not in the spec's table).

## Where the code is

| What | Files |
|---|---|
| Database (anon may call these three; nothing else) | `supabase/migrations/20261231002200_public_presentation.sql`, `20261231002300_public_presentation_review_fixes.sql`, `20261231002400_public_lessons.sql` (newest `public_presentation`, `public_first_slide`, `public_lessons`, `public_lesson_ids`) |
| SQL tests | `supabase/tests/public_presentation.sql`, `public_lessons.sql`, `anon_grants.sql` (lists what anon may run) |
| Who may open what logged out | `src/proxy.ts`, `src/lib/publicPaths.ts` (+ test) |
| App reads (anon client, no cookies) | `src/lib/publicPresentation.ts` (+ test) |
| Preview page, its tags | `src/app/presentation/[id]/page.tsx` (logged-out branch, `generateMetadata`), `PublicPresentation.tsx` |
| Link pictures | `src/app/ogCard.tsx`, `src/app/opengraph-image.tsx` (site, made at build), `src/app/presentation/[id]/opengraph-image.tsx` |
| Public home | `src/app/welcome/page.tsx`, `LessonCards.tsx`; `src/components/LoggedOutBar.tsx`; `FEATURES` in `src/components/LoginAbout.tsx` |
| Robots, sitemap, titles | `src/app/robots.ts`, `src/app/sitemap.ts`, root `src/app/layout.tsx` (`metadataBase`, title template), each page's `metadata`, `login/`, `login/verify/`, `forgot-password/` `layout.tsx` |
| Shared slide components touched | `src/components/editor/EmbedSlide.tsx`, `src/components/presentation/SlideStaticView.tsx`, `FluidSlidePreview.tsx`, `src/components/editor/Editor.tsx` (sr-only h1) |
| Words | Share card line (`src/components/editor/ShareButton.tsx`), Privacy Policy section 4 + short version, Terms section 4, `LEGAL_VERSION` 2026-11-20 |
| Browser tests | `e2e/public-preview.mjs`, `e2e/public-home.mjs`, `e2e/proxy.mjs` |
| Notes | `src/app/CLAUDE.md` ("Public preview", "The public home, sitemap and titles"), `src/components/CLAUDE.md`, `supabase/migrations/CLAUDE.md`, `e2e/CLAUDE.md`, root `CLAUDE.md` map |

Commits (on `dev`, oldest first): `e9bb735` … `57bf999`. Two commits in that range are **not** part of this work
(another session's "___ blank lines" feature): `709268b`, `a1a4b24`. See the whole change with
`git diff 104bfc1..57bf999 -- . ':!src/lib/blanks*' ':!src/lib/blankLines.ts' ':!e2e/blank-lines.mjs'`.

## Deploy state (as of writing)

Not pushed and not live. Order: paste `20261231002200`, then `20261231002300`, then `20261231002400` into the live
SQL editor, then push `dev`; check a link in Facebook's Sharing Debugger on the preview (the `og:image` address is
`https://quizmatter.com/…` only on a real build; `next dev` writes its own host). If they're already live when you
read this, a change to these functions needs a **new** migration.

## Known gaps (not fixed, by choice or for later)

1. **Teachers who published before 2026-11-20 never agreed** to public previews (only new sign-ups see the new
   Privacy version). Names and answers are kept out, but their earlier work became public. An announcement would
   tell them.
2. Logged-out visitors **can't report** a presentation (only logged-in teachers). Hiding still removes the preview
   at once; Facebook keeps its copy of the picture until re-scraped.
3. A teacher's shared copy can have a first slide up to 2 MB that anyone can fetch repeatedly through
   `public_presentation` (egress). A free account could already do the same while logged in, so not new, but now
   no account is needed.
4. A user whose login fully expired lands on the public home at `/` instead of the login page (one click away).
5. The public home repeats the login page's claim "1,000+ ready-to-use quizzes", now visible to Google: check it's
   true.
6. The sitemap pages through lessons by `updated_at`; a lesson changed during the read could be listed twice or
   missed until the next read (harmless).

## Checked and safe (re-check these first)

- Only `is_published and hidden_at is null` rows come back; private, hidden and unknown answer the same (307 to
  login; picture 404).
- The `presentations` / `slides` tables stay closed to `anon` (`anon_grants.sql`).
- No SQL built from input; text escaped by React; slide HTML through `toSafeHtml`.
- `next=` only ever points back to this site; maintenance stops logged-out visitors before any of this runs.
- `/welcome` is rendered per request (production build route table: `ƒ /welcome`), so the lesson list isn't frozen
  at build time.

## How to test

On the local Docker Supabase only: `npm run test:sql` (49 of 49 on 2026-11-20), `npm test`, `npx tsc --noEmit`,
`npm run lint`; with `npm run e2e:dev` running: `node e2e/public-preview.mjs` (25), `node e2e/public-home.mjs` (20),
`node e2e/proxy.mjs` (12), `node e2e/security-headers.mjs` (10).

## Where to start the review

1. The three migrations and `public_first_slide`: is there any path that returns something a logged-out visitor
   shouldn't see?
2. `src/proxy.ts` and `src/lib/publicPaths.ts`: can anything else be reached logged out?
3. Then run the independent review:

```
/code-review high supabase/migrations/20261231002200_public_presentation.sql supabase/migrations/20261231002300_public_presentation_review_fixes.sql supabase/migrations/20261231002400_public_lessons.sql src/proxy.ts src/lib/publicPaths.ts src/lib/publicPresentation.ts src/app/presentation/[id]/page.tsx src/app/presentation/[id]/PublicPresentation.tsx src/app/presentation/[id]/opengraph-image.tsx src/app/ogCard.tsx src/app/opengraph-image.tsx src/app/welcome/page.tsx src/app/welcome/LessonCards.tsx src/app/sitemap.ts src/app/robots.ts src/app/layout.tsx src/components/editor/EmbedSlide.tsx src/components/presentation/SlideStaticView.tsx
```

## Review fixes (2026-11-20, after `/code-review high`)

All in the same unpushed migrations, so the deploy order above is unchanged.

- An editor's lesson shows the editor's display name (it is its Author, set by the database). The owner chose to
  keep that and say so in the Privacy Policy (section 4, "If you're an editor"), rather than hide it.
- New `public_presentation_card(p_id)`: the details without the slide (granted to anon). The proxy's check and the
  link picture use it, so a logged-out visit or a prefetch from the public home no longer pulls a 2 MB slide just to
  check that the page exists. `public_presentation` = the card + `public_first_slide`.
- `public_first_slide` drops `hidden`, so visitors never see the owner's "Hidden when presenting" mark.
- `welcome/page.tsx` is `force-dynamic` and has a `loading.tsx`.
- Smaller ones: the title of a page that isn't public is `absolute` "QuizMatter"; the preview's `openGraph` has
  `siteName`; "Log in to see it" for 0 slides; `PeopleArtGate fill` (the wait fills only the slide box); the
  description is cut by whole characters (no split emoji).
