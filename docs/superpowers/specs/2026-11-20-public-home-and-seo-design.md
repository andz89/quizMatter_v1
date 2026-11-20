# Public home page, sitemap, page titles and h1s (link previews and SEO, part 2)

## Why

Part 1 (`2026-11-20-public-presentation-preview-design.md`) opened published presentations' previews to logged-out
visitors and robots. The site itself still shows Google nothing: `/` sends logged-out visitors to `/login`, there is
no sitemap, every page's browser-tab title is "QuizMatter", and the editor has no `<h1>`. The owner wants QuizMatter
found on Google and every page to have a proper `<h1>`.

## Goals

- A logged-out visitor (or robot) at `/` sees a public home page: what QuizMatter is, Sign up / Log in, and the
  newest QuizMatter lessons, each linking to its public preview (links Google can follow).
- `/sitemap.xml` lists the public pages and the QuizMatter lessons' previews.
- Every page has its own title ("Saved · QuizMatter", "Log in · QuizMatter", …) and exactly one `<h1>`.
- Sign-in-step pages are kept out of search results.

## Non-goals

- Changing the logged-in home page (tabs, cards) in any way.
- Listing teachers' own shared presentations anywhere public (see "Sitemap scope").
- A logged-out report button, structured data (JSON-LD), other languages.

## Anti-goals

- A logged-in teacher at `/` sees anything but their home page as today.
- A new way for logged-out visitors to read private or hidden presentations, names or answers (the part 1 rules
  hold: no display names, no answers, no YouTube requests).
- Two addresses for the same page (duplicate content): the public home is only ever served at `/`.

## Approaches considered (the public home at `/`)

1. **The proxy quietly serves a separate page at `/` for logged-out visitors** (`NextResponse.rewrite` to
   `/welcome`; the address stays `/`). The logged-in home and its layout don't change. **Picked (my call).**
2. Make `(home)/page.tsx` and `(home)/layout.tsx` handle "no login". Every tab's layout reads the account and loads
   counts; threading "logged out" through it risks the logged-in home, the one page that must not change.
3. Keep `/` → `/login` and only improve the login page. Google would have no real landing page.

## Design

### The public home (`src/app/welcome/page.tsx`, served at `/`)

- `src/proxy.ts`: a logged-out request for `/` is answered with a rewrite to `/welcome` (keeping the refreshed
  cookies, `keepSession`). A direct request for `/welcome`, logged in or out, redirects to `/`, so it never has
  two addresses. Maintenance still stops everything first, as today.
- The page (server): `LoggedOutBar` (its logo now links to `/` instead of `/login`), then:
  - Hero: `<h1>` "Build presentations with quizzes built in", a line under it ("QuizMatter helps teachers make
    bright, simple lessons and quizzes that kids love to play."), main button "Sign up free" (`/signup`), second
    button "Log in" (`/login`).
  - The four feature rows the login page shows (`LoginAbout`'s list, moved into an exported `FEATURES` array that
    both use; not copied).
  - "Ready-made lessons from QuizMatter": the newest 8 QuizMatter lessons as cards (first slide drawn with
    `FluidSlidePreview`, `showVideoCover={false}`, the title, subject · grades), each a link to
    `/presentation/<id>` (their public preview). No lessons: the section isn't shown.
- Metadata: title (absolute) "QuizMatter: presentations with quizzes built in", the root description, canonical `/`.
- Logged in, `/` is the home page as today (the proxy doesn't rewrite).

### Database: `public_lessons(p_limit int)`

One `security definer` function, `execute` to `anon` and `authenticated`, like `public_presentation`: the newest
(`updated_at` desc) published, not hidden QuizMatter lessons (`from_admin`), at most `p_limit` (1–50; else
`22023`), returning `id`, `title`, `subject`, `grades`, `updated_at`, and `first_slide` with the same rules as
`public_presentation` (first shown slide, answer removed). No names. `anon_grants.sql` lists it.

The sitemap uses a second, lighter one, `public_lesson_ids()`: every published, not hidden QuizMatter lesson's `id`
and `updated_at`, newest first (no slide data). Same grants. Read in pages of 1,000 (the API's row limit), at most
50,000 (a sitemap's limit).

### Sitemap scope (my call)

`src/app/sitemap.ts`: `/`, `/login`, `/signup`, `/privacy`, `/terms`, and each QuizMatter lesson's
`/presentation/<id>` with its `updated_at`. **Teachers' own shared presentations are not listed:** they are public
to anyone with the link (part 1), but QuizMatter doesn't advertise a teacher's work to search engines without their
say. `robots.ts` gains `sitemap: "https://quizmatter.com/sitemap.xml"`. The proxy lets `/sitemap.xml` through.

### Page titles

The root layout's title becomes `{ default: "QuizMatter", template: "%s · QuizMatter" }`; each page sets a short
title (pages that wrote "… · QuizMatter" themselves drop it; the part 1 preview keeps its own as `absolute`).

| Page | Title |
|---|---|
| `/` logged in (`(home)/page.tsx`) | My presentations |
| `quizmatter/`, `teachers/`, `saved/`, `liked/`, `reviews-submissions/`, `search/` | From QuizMatter, Other teachers, Saved, Liked, Reviews & submissions, Search |
| `presentations/` | All my presentations |
| `account/`, `account/two-step/` | Account, Two-step login |
| `teachers/[slug]` | Teacher profile |
| `presentation/[id]` logged in, `presentation/[id]/edit`, `presentation/new` | Presentation, Editor, Editor |
| `login/` (layout, the page is a client component), `signup/` | Log in, Sign up |
| `forgot-password/`, `set-password/`, `auth/confirm/`, `login/verify/`, `oauth/consent/` | Forgot password, Set a new password, Confirm your email, Two-step login, Connect Claude, all `robots: { index: false }` |
| `admin` (layout) | Admin |
| `privacy`, `terms`, `maintenance` | Privacy Policy, Terms of Use, Under maintenance |

Client-component pages (`login`, `login/verify`, `forgot-password`) get a small `layout.tsx` next to them holding
only the metadata.

### h1s

Every page already has one (in its layout or a child component) except the editor: `Editor` gets a screen-reader
only `<h1 className="sr-only">` with the presentation's title ("Untitled presentation" when empty), which changes
nothing on screen.

### Notes and policy

- Notes: `src/app/CLAUDE.md` (the public home, sitemap, titles), root `CLAUDE.md` map (`src/proxy.ts` line:
  `/` and `/sitemap.xml`), `src/components/CLAUDE.md` (`LoggedOutBar` links to `/`, `FEATURES`),
  `supabase/migrations/CLAUDE.md` (anon's list).
- Privacy Policy: the public home shows QuizMatter lessons' title, subject, grades and first slide, which section 4
  already says are public; add "and the newest QuizMatter lessons on the public home page" there. `LEGAL_VERSION`
  stays 2026-11-20 (same day).

### Tests

- SQL (`supabase/tests/public_lessons.sql`): as `anon`, `public_lessons` gives only published, not hidden
  QuizMatter lessons, newest first, at most `p_limit`, answers removed, no teacher copies; 0 and 51 refused;
  `public_lesson_ids` the same set; tables still closed.
- Browser (`e2e/public-home.mjs`): logged out, `/` shows the `<h1>`, Sign up / Log in, a lesson card linking to its
  preview, and stays at `/`; `/welcome` redirects to `/`; logged in, `/` is the normal home ("Presentations" h1);
  `/sitemap.xml` lists a lesson and not a teacher's copy; `robots.txt` names the sitemap; a few titles (Log in,
  Saved); the editor has one `<h1>`.
- `e2e/proxy.mjs`: `/sitemap.xml` opens logged out.
- Unit: `publicPaths` for `/sitemap.xml`.

### Deploy order

Database first: the user pastes the migration into the live SQL editor, then `dev` is pushed.

## Left to the builder

- The exact layout of the public home within the design system (phone width first).
- Whether the lesson card is its own small component or reuses parts of `PresentationCard`, as long as it shows no
  bookmark, like or menu.
