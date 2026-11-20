# Public presentation preview (link previews and SEO, part 1)

## Why

The owner wants QuizMatter to show up well when a link is shared (Facebook, Messenger, Viber) and in Google. Today
`src/proxy.ts` sends every logged-out visitor to `/login`, and robots (Google, Facebook's link reader) are always
logged out. So a shared presentation link shows the login page's preview, and Google can't read any presentation.

This is part 1 of 2. Part 2 (later, its own design) is a public home page for logged-out visitors at `/`, a
`sitemap.xml`, page titles and the missing `<h1>`s.

## Goals

- A logged-out visitor (or robot) who opens a **published** presentation's link sees a small public preview: the
  title (as the page's `<h1>`), the author, subject and grades, the number of slides, the description, the first
  shown slide, and buttons to log in or sign up to see the rest.
- Shared links get a proper preview picture: a QuizMatter **title card** (the owner's choice: not a picture of the
  slide, for now) with the title and author on it.
- Every other page shared or found logged out (login, sign up, …) gets one fixed QuizMatter picture.
- Google may read and list published presentations' preview pages.

## Non-goals

- A real picture of slide 1 for the link preview. Rejected for now (see Approaches); the title card can be swapped
  later.
- Showing more than the first shown slide to logged-out visitors. Presenting, Make a copy, Save, Like and Report stay
  logged-in only.
- The public home page, sitemap, page titles elsewhere and the other `<h1>`s (part 2).

## Anti-goals (a failure even if it works)

- A private presentation, a hidden (moderated) shared copy, or anything else a logged-out person can't read today
  becomes readable, or its existence leaks (a private link must still look exactly like today: go to login).
- Teachers' emails, contact numbers, birthdays, reviewers' emails or "Reviewed by" lines show publicly.
- Plain teachers get a way to upload pictures (they can't today, on purpose).

## Approaches considered (for the preview picture)

1. **Cloudflare takes a screenshot of slide 1** (Browser Rendering). Exact and safe, but needs the Workers Paid plan
   plus browser time and more setup.
2. **The teacher's browser takes it and uploads it.** Free and exact, but opens picture uploads to every teacher
   (closed on purpose, `src/app/api/upload-image/route.ts`), and a direct call could send any picture as the cover.
3. **The server draws a simple version of the slide** (`next/og`). Free and safe, but rough: WebP photos don't
   show, and diagrams, tables and fonts come out only roughly right.
4. **A QuizMatter title card** (`next/og`, text only). Free, safe, always looks right. **The owner picked this.**
   The page itself still shows the real slide 1 (drawn live in the browser like a home card), so visitors see it.

## Design

### Who sees what

| Visitor | `/presentation/<id>` | 
|---|---|
| Logged in | Exactly as today (no change). |
| Logged out, presentation published and not hidden | The public preview (below). |
| Logged out, anything else (private, hidden, deleted, unknown id) | Redirect to `/login?next=/presentation/<id>`, as today. |

"Published and not hidden" is the same rule logged-in teachers have today (`is_published and hidden_at is null`,
the "Read published presentations" policy): teachers' shared copies and shared QuizMatter lessons. Everything else
under `/presentation/` (`/edit`, `/new`) stays logged-in only.

### Database: `public_presentation(p_id text)`

A new migration with one function, `security definer`, `stable`, `set search_path = ''`, `execute` granted to `anon`
and `authenticated` (revoked from `public`). It returns one row, or none when the presentation isn't published or is
hidden:

- `title`, `description`, `subject`, `grades`, `from_admin`
- `author_name`: the Author text when it's filled; else "QuizMatter" for a QuizMatter lesson; else the owner's name
  exactly as the logged-in view page shows it (the same source as `loadPublisherNames`, `src/lib/publishers.ts`;
  never an email).
- `slide_count`: the number of shown (not hidden) slides, the same count the view page's Prev/Next uses.
- `first_slide`: the `data` of the first shown slide by `position` (null if there's none).

Nothing else (no owner id, no review or submission details). Tables keep their policies: `anon` still can't read
`presentations` or `slides` directly. During maintenance the database guard already refuses `anon`, and the proxy
sends visitors to `/maintenance` first anyway.

The app reads it in a new `src/lib/publicPresentation.ts` (server only): one function that calls the RPC with a
plain Supabase client (the anon key, no login cookies, so it's the same for everyone and for robots), parses
`first_slide` through the app's slide schema (which upgrades old shapes, as `parseSavedPresentation` does; a slide
that fails is shown as no slide, not an error) and returns a typed object or null. It's wrapped in React's `cache()`
so the page and its metadata make one call per request.

### Proxy (`src/proxy.ts`)

Logged-out visitors may also open:

- `/presentation/<uuid>` (exactly a uuid, nothing after it) and its picture,
  `/presentation/<uuid>/opengraph-image…`;
- `/opengraph-image…` (the site picture) and `/robots.txt`.

The page itself decides between the preview and the redirect to login (the proxy can't know if it's published
without a database call). Logged-in behavior and maintenance don't change. `e2e/proxy.mjs` gets these cases.

### The page (`src/app/presentation/[id]/page.tsx`)

If there's no login (`getAccount()` has no `id`): read `public_presentation`; none → `redirect` to login with `next`;
else render a new `PublicPresentation.tsx` next to the page. Logged in: the current code, unchanged.

`PublicPresentation` (server component; design system throughout):

- The same logged-out top bar as `(legal)/layout.tsx` (logo + Log in). Move that bar into one small shared
  component (e.g. `src/components/LoggedOutBar.tsx`) and use it in both places; don't copy it.
- One card, max width like the view page: the first shown slide with `FluidSlidePreview` (as home cards do), inside
  `PeopleArtGate` when it uses people art; no slide → a plain "No slides yet" box.
- `<h1>` with the title (Bricolage, `font-extrabold`); "By <author_name>"; a line with subject, grades and
  "<n> slides"; the description (plain text, as on the view page).
- Main button "Log in to see all <n> slides" → `/login?next=/presentation/<id>`; second button "Sign up free" →
  `/signup`. Both with `LinkPending`.

### Link preview tags

- Root layout `metadata`: `metadataBase: new URL("https://quizmatter.com")` (so picture links are full addresses),
  `openGraph: { siteName: "QuizMatter", type: "website" }`, `twitter: { card: "summary_large_image" }`.
- `src/app/opengraph-image.tsx`: the site picture, built once at build time (no data): 1200 × 630, Paper background,
  the Q-Check mark and "QuizMatter", and "Build presentations with quizzes built in."
- `src/app/presentation/[id]/opengraph-image.tsx`: the title card, 1200 × 630, made on request from
  `public_presentation`: the Q-Check mark and "QuizMatter" on top, the title large (Bricolage ExtraBold, at most 3
  lines, cut with "…"), "By <author_name>", then subject · grades · "<n> slides". Not public → the same picture as
  the site's. Colors from the design system (violet, Paper, Ink). `alt` = "<title> on QuizMatter". Sent with a
  cache header (an hour in the browser, a day at Cloudflare), so a robot asking again costs nothing; a renamed
  presentation's card can be a day old, which is fine.
- `generateMetadata` on `presentation/[id]/page.tsx` (uses the same cached read): published → title
  "<title> · QuizMatter", description = its description cut to about 160 characters, or "<title> by <author> on
  QuizMatter: <n> slides." when it has none; `openGraph.type: "article"`; `alternates.canonical:
  "/presentation/<id>"`. Not published → title "QuizMatter" and `robots: { index: false }`. The picture comes from
  the `opengraph-image` file by itself.
- `src/app/robots.ts`: allow everything except `/admin`, `/api/`, `/account`, `/presentation/*/edit`,
  `/presentation/new` (tidy only; they redirect logged-out robots anyway). No sitemap yet (part 2).

### Sharing words

The Share card (`src/components/editor/ShareButton.tsx`), where it explains Published, adds one line: "Anyone with
the link can see its title, author and first slide. The rest needs a QuizMatter login." Same words wherever a
QuizMatter lesson's Draft / Shared switch explains sharing.

### Privacy Policy and notes (required)

- Privacy Policy, section 4 ("Who can see your information"): pages are no longer closed to everyone else. Add that
  anyone with the link, and search engines, can see a published presentation's title, description, subject, grades,
  Author (or display name), number of slides and first slide. Read the Terms of Use for the same "closed" claim and
  fix it too. Bump `LEGAL_VERSION` to the commit's date.
- Notes: `src/app/CLAUDE.md` (a "Public preview" part under the presentation pages, and the proxy line under login),
  the root `CLAUDE.md` map (`src/proxy.ts` line: what logged-out visitors may open),
  `supabase/migrations/CLAUDE.md` if it lists functions.
- `npm run db:snapshot` after the migration.

### Tests

- SQL (`supabase/tests/public_presentation.sql`, on Docker): as `anon`, a published one comes back with the right
  author name and first shown slide (a hidden first slide is skipped) and count; a private one, a hidden shared copy
  and an unknown id come back empty; `anon` still can't select from `presentations` / `slides`; columns are only the
  listed ones.
- Browser (`e2e/public-preview.mjs`, reuse `e2e/lib.mjs`): logged out, a published presentation shows the `<h1>`
  title, slide and buttons, and has `og:title`, `og:image` (a full `https://` address) and `twitter:card` tags; the
  `og:image` address answers `image/png`; a private one and `/edit` go to login; logged in, the page is the normal
  view page.
- `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npx opennextjs-cloudflare build` (the `next/og` part must
  build for Workers; check the Worker's size stays under Cloudflare's limit, and say how much it grew).

### Deploy order

Database first, as always: the user pastes the migration into the live SQL editor, then the code goes to `dev`.
After the preview deploys, check a published link with Facebook's Sharing Debugger.

## Left to the builder

- How the fonts get into the picture: Bricolage Grotesque ExtraBold (title) and Lexend (the rest), as TTF files read
  the way Next's docs show. It must work in the built Worker (`npx opennextjs-cloudflare preview`); if reading a file
  doesn't work there, load them another way that does. Titles in Filipino (ñ) must draw correctly.
- Drawing the Q-Check mark in the picture (reuse `Logo.tsx`'s SVG paths; don't redraw it differently).
- The exact layout of the card and the page, within the design system.
- The name of the hidden-slide field and the people-art check: follow what the view page and home cards do.

## As built (2026-11-20)

Three calls made while building, which change the design above:

- **The proxy redirects a non-public presentation itself.** The page streams (under `presentation/loading.tsx`), so
  its own `redirect` arrived as a 200 page that moved to login a moment later. To keep "exactly like today" (a real
  307 to login), `src/proxy.ts` asks `public_presentation` for a logged-out visit to `/presentation/<uuid>` (one small
  read, logged-out visitors only). The page still checks again.
- **The picture's fonts are in the code** (`src/app/fonts/ogFonts.ts`, base64), not files read from disk: a Worker
  can't be relied on to read files, and checking the built Worker locally would have touched the live database.
- **The picture is kept for one hour** (`Cache-Control: public, max-age=3600`), not a day: a Worker's answers aren't
  kept in Cloudflare's cache anyway, and a presentation made private shouldn't keep its card long.
