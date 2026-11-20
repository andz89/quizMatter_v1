# Public Presentation Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logged-out visitors and robots can open a published presentation's link and see a small public preview, and shared links get a QuizMatter title-card picture.

**Architecture:** One `security definer` database function (`public_presentation`) is the only thing `anon` may call to read a presentation. The proxy lets logged-out visitors reach `/presentation/<uuid>` (and the picture routes); the page shows `PublicPresentation` when there's no login, or redirects to login when the function returns nothing. `next/og` draws the title card and the site picture.

**Tech Stack:** Next.js 16 (App Router, `next/og`, metadata files), Supabase (Postgres function, anon grant), OpenNext on Cloudflare Workers, Playwright e2e, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-20-public-presentation-preview-design.md`

## Global Constraints

- Published = `is_published and hidden_at is null` (the "Read published presentations" policy). Nothing else becomes readable to `anon`.
- A non-public presentation, logged out, must look exactly like today: redirect to `/login?next=/presentation/<id>`.
- Logged-in behavior of every page is unchanged.
- Picture size 1200 × 630, PNG. Title at most 3 lines, cut with "…".
- Design system only (`globals.css` classes, Lucide, the one `Spinner`, `LinkPending`); in `next/og` use the design system's hex values (`#FAF8FF`, `#6B3DF5`, `#1B1530`, `#756E8E`, `#FFC233`).
- Main button words: "Log in to see all <n> slides"; second button: "Sign up free". Share card line: "Anyone with the link can see its title, author and first slide. The rest needs a QuizMatter login."
- All DB testing on local Docker only. Packages (if any) with `npx -y npm@10.9.2`. No new package is expected (`next/og` ships with Next).
- Privacy Policy + `LEGAL_VERSION` (`"2026-11-20"`) and the folder `CLAUDE.md` notes change in the same work.

## Review Focus

- A presentation whose every slide is hidden: count and first slide follow `shownSlides` (all slides count, first one shows). Test in Task 1.
- A first slide in an old saved shape: the preview still opens (upgraded by `parseSlide`), and a broken one shows "No slides yet" instead of an error. Test in Task 2.
- A title with Filipino letters (ñ) or very long: the card draws it and cuts at 3 lines. Checked by eye in Task 5 (open the PNG).
- `/presentation/<uuid>/edit`, `/presentation/new`, `/presentation/not-a-uuid` logged out still go to login. Test in Task 3.
- A hidden shared copy's link, logged out, goes to login (not "not found", not the preview). Test in Tasks 1 and 7.

---

### Task 1: The database function

**Files:**
- Create: `supabase/migrations/20261231002200_public_presentation.sql`
- Create: `supabase/tests/public_presentation.sql`
- Modify: `supabase/tests/anon_grants.sql` (allow `public_presentation` in the function list and the comment at the top)
- Modify: `supabase/schema.sql`, `src/lib/database.types.ts` (by `npm run db:snapshot`)

**Interfaces:**
- Produces: `public.public_presentation(p_id text) returns table (title text, description text, subject text, grades text[], from_admin boolean, author_name text, slide_count int, first_slide jsonb)`; `execute` to `anon, authenticated`, revoked from `public`.

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/public_presentation.sql` (same shape as `supabase/tests/hidden_slides.sql`: `begin; … rollback;`, `raise exception 'FAIL: …'`). Setup as postgres: one teacher (display name "Tess Teacher"), one admin. Presentations:
  - P1 published, author '' , slides: s1 `{"hidden": true}`, s2 shown, s3 shown → as `anon` (`set local role anon`): one row, `author_name = 'Tess Teacher'`, `slide_count = 2`, `first_slide->>'id'` = s2's id.
  - P2 published, author 'Ma. Santos' → `author_name = 'Ma. Santos'`.
  - P3 published, every slide hidden (2 slides) → `slide_count = 2`, first slide = position 0.
  - P4 published by the admin, `from_admin`, author '' → `author_name = 'QuizMatter'`.
  - P5 private (`is_published = false`), P6 published with `hidden_at = now()`, and `'nope'` → zero rows each.
  - As `anon`: `select … from public.presentations` and `public.slides` raise `insufficient_privilege` (catch it in a `do` block; no error = FAIL).
  - Also as `authenticated` (another teacher's claims): P1 returns the same row.
  Insert slides the way `hidden_slides.sql` does (check what triggers need: `data_version`, a question so it can be published, or insert as postgres with `is_published` set directly).
- [ ] **Step 2: Run it, expect FAIL** — `npm run test:sql -- public_presentation.sql` → error "function public.public_presentation(text) does not exist".
- [ ] **Step 3: Write the migration.** Comment on top (what and why, plain English). `language sql stable security definer set search_path = ''`. Shown slides = `coalesce((data->>'hidden')::boolean, false) = false`; when none are shown, use all slides (same as `shownSlides` in `src/lib/constants.ts`). `author_name`: `nullif(btrim(p.author), '')`, else `'QuizMatter'` when `p.from_admin`, else the `publisher_names` rule for a non-admin caller (admin owner → 'QuizMatter', else `user_settings.display_name`, else ''). Then `revoke execute … from public, anon, authenticated; grant execute … to anon, authenticated;`.
- [ ] **Step 4: Allow it in `anon_grants.sql`** (`p.proname not in ('maintenance_status', 'check_maintenance', 'public_presentation')`, and name it in the top comment).
- [ ] **Step 5: Run** `npm run test:sql` → every file passes (ends with ROLLBACK, no FAIL/ERROR).
- [ ] **Step 6: Snapshot** `npm run db:snapshot`; check `database.types.ts` has `public_presentation` under `Functions`.
- [ ] **Step 7: Commit** — `feat: public_presentation, the one read a logged-out visitor may make`.

### Task 2: Reading it in the app

**Files:**
- Create: `src/lib/publicPresentation.ts`
- Create: `src/lib/publicPresentation.test.ts`

**Interfaces:**
- Consumes: `public_presentation` (Task 1); `parseSlide` (`src/lib/schema.ts`).
- Produces:
  - `type PublicPresentation = { id: string; title: string; description: string; subject: string; grades: string[]; fromAdmin: boolean; authorName: string; slideCount: number; firstSlide: Slide | null }`
  - `toPublicPresentation(id: string, row: unknown): PublicPresentation | null` (pure; null for null/undefined row)
  - `publicDescription(p: PublicPresentation): string` (pure)
  - `getPublicPresentation: (id: string) => Promise<PublicPresentation | null>` — `cache()` from React; a plain `createClient` from `@supabase/supabase-js` with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `auth: { persistSession: false }`; an error from the RPC throws (the page's `error.tsx` shows it), no row → null.

- [ ] **Step 1: Write the failing tests** in `publicPresentation.test.ts`:
  - `toPublicPresentation("x", null)` → `null`.
  - A row with a valid slide (copy a minimal slide from an existing `*.test.ts` that builds one) → `firstSlide.id` equals it, snake_case mapped to camelCase, `slideCount` kept.
  - A row whose `first_slide` is `{ "nonsense": 1 }` → `firstSlide === null`, the rest still filled.
  - `publicDescription` with description "Fractions for Grade 4" → that text; with a 300-character description → at most 160 characters, ends with "…"; with "" → `"<title> by <authorName> on QuizMatter: <n> slides."` (and `"… on QuizMatter: 1 slide."` for one).
- [ ] **Step 2: Run** `npm test` → the new tests fail (module not found).
- [ ] **Step 3: Implement** the four exports above.
- [ ] **Step 4: Run** `npm test` → pass.
- [ ] **Step 5: Commit** — `feat: read a published presentation's public preview`.

### Task 3: Let logged-out visitors through the proxy

**Files:**
- Create: `src/lib/publicPaths.ts`, `src/lib/publicPaths.test.ts`
- Modify: `src/proxy.ts:43-47` (use it for `isOpenToAll`)
- Modify: `e2e/proxy.mjs` (new cases)

**Interfaces:**
- Produces: `isPublicPreviewPath(path: string): boolean` — true for `/presentation/<uuid>`, `/presentation/<uuid>/opengraph-image` plus any suffix without a `/` (Next may add one), `/opengraph-image…` (same rule), `/robots.txt`. Uuid = the `z.uuid()` shape, lower or upper case.

- [ ] **Step 1: Write failing tests** in `publicPaths.test.ts`: true for `/presentation/0b7c…-uuid`, `/presentation/<uuid>/opengraph-image`, `/presentation/<uuid>/opengraph-image-1a2b3c`, `/opengraph-image`, `/robots.txt`; false for `/presentation/<uuid>/edit`, `/presentation/new`, `/presentation/abc`, `/presentation/<uuid>/`, `/presentation/<uuid>/opengraph-image/x`, `/`, `/admin`.
- [ ] **Step 2: Run** `npm test` → fail.
- [ ] **Step 3: Implement**, then in `proxy.ts` add `|| isPublicPreviewPath(path)` to `isOpenToAll` and say so in its comment. Maintenance branch unchanged.
- [ ] **Step 4: Run** `npm test` → pass.
- [ ] **Step 5: Add to `e2e/proxy.mjs`** (logged out, `redirect: "manual"`): `/robots.txt` is not a redirect to `/login`; `/presentation/<uuid>/edit` and `/presentation/not-a-uuid` still redirect to `/login`. (The page's own redirect is tested in Task 7.)
- [ ] **Step 6: Commit** — `feat: logged-out visitors may open a presentation's link (the page decides)`.

### Task 4: The public page

**Files:**
- Create: `src/components/LoggedOutBar.tsx` (the bar now inside `src/app/(legal)/layout.tsx`, moved as is)
- Modify: `src/app/(legal)/layout.tsx` (use `LoggedOutBar`)
- Create: `src/app/presentation/[id]/PublicPresentation.tsx`
- Modify: `src/app/presentation/[id]/page.tsx` (branch + `generateMetadata`)

**Interfaces:**
- Consumes: `getPublicPresentation`, `publicDescription`, `PublicPresentation` (Task 2).
- Produces: `PublicPresentation({ presentation }: { presentation: PublicPresentation })` (rename the import to avoid the name clash, e.g. `type PublicPresentation as PublicData`); `LoggedOutBar()`.

- [ ] **Step 1: Move the bar** into `LoggedOutBar.tsx`; `(legal)/layout.tsx` renders `<LoggedOutBar />` in its logged-out branch. Open `/privacy` logged out in the browser: looks the same.
- [ ] **Step 2: Page branch.** In `page.tsx`, after the uuid check: `const account = await getAccount()`; no `account.id` → `getPublicPresentation(id)`; null → `redirect(\`/login?next=${encodeURIComponent(\`/presentation/${id}\`)}\`)` (same `next` form the proxy builds); else return `<><LoggedOutBar /><PublicPresentation … /></>`. The logged-in path keeps its code (reuse the `account` already read; don't read it twice).
- [ ] **Step 3: `PublicPresentation.tsx`** per the spec's "The page": card with `FluidSlidePreview` of `firstSlide` (with `questionNumber` the way `PresentationCard.tsx` passes it) inside `PeopleArtGate needed={usesPeopleArt([firstSlide])}`; no slide → "No slides yet" box; `<h1>` title; "By <authorName>" (left out when empty); subject · grades (use the same grade words the view page uses) · "<n> slides"/"1 slide"; description; the two buttons (main-button classes / a bordered second button), each with `LinkPending`.
- [ ] **Step 4: `generateMetadata`** in `page.tsx`, from `getPublicPresentation` (works logged in too): found → `{ title: \`${title} · QuizMatter\`, description: publicDescription(p), openGraph: { type: "article", title, description }, alternates: { canonical: \`/presentation/${id}\` } }`; not a uuid or not found → `{ title: "QuizMatter", robots: { index: false } }`.
- [ ] **Step 5: Check** `npx tsc --noEmit` and `npm run lint` clean; with `npm run e2e:dev` running, open a published presentation logged out (make one with the e2e helpers or the app) and a private one: preview and login redirect.
- [ ] **Step 6: Commit** — `feat: the public preview page for a published presentation`.

### Task 5: The pictures, site metadata and robots.txt

**Files:**
- Create: `src/app/ogCard.tsx` (shared drawing), `src/app/opengraph-image.tsx`, `src/app/presentation/[id]/opengraph-image.tsx`, `src/app/robots.ts`
- Create: font files under `src/app/fonts/` (Bricolage Grotesque ExtraBold and Lexend Regular/SemiBold TTF, from Google Fonts' open files; both are OFL, keep their `OFL.txt` next to them)
- Modify: `src/app/layout.tsx` (metadata)

**Interfaces:**
- Consumes: `getPublicPresentation` (Task 2); the Q-Check paths from `src/components/Logo.tsx`.
- Produces: `ogCard(content: { title: string; byline: string; details: string } | null): Promise<ImageResponse>` (null = the site picture); exports `OG_SIZE = { width: 1200, height: 630 }`.

- [ ] **Step 1: Root metadata** in `layout.tsx`: add `metadataBase: new URL("https://quizmatter.com")`, `openGraph: { siteName: "QuizMatter", type: "website" }`, `twitter: { card: "summary_large_image" }`.
- [ ] **Step 2: `ogCard`.** The spec's layout; the mark drawn from `Logo.tsx`'s SVG paths; title `lineClamp: 3` (Satori supports it) ; send `headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" }`. Fonts loaded once per server copy (module level).
- [ ] **Step 3: The two routes.** `src/app/opengraph-image.tsx`: `alt = "QuizMatter"`, `size`, `contentType = "image/png"`, returns `ogCard(null)`. `presentation/[id]/opengraph-image.tsx`: not a uuid or not public → `ogCard(null)`; else `ogCard({ title, byline: authorName ? \`By ${authorName}\` : "", details: subject · grades · "<n> slides" })`; `alt = "A presentation on QuizMatter"` (static export; the title is in og:title).
- [ ] **Step 4: `robots.ts`**: `{ rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/account", "/presentation/new", "/presentation/*/edit"] } }`.
- [ ] **Step 5: Check by eye** (dev server): open `/opengraph-image` and `/presentation/<id>/opengraph-image` for a title "Mga Bahagi ng Pangungusap: Ang Simuno at Panaguri sa Pangungusap ng Batang Niño" (long, with ñ): PNG, brand fonts, ñ drawn, cut at 3 lines. Logged out, view the page source: `og:image` is `https://quizmatter.com/…`, `twitter:card` present.
- [ ] **Step 6: Build for Workers** `npx opennextjs-cloudflare build`, then `npx opennextjs-cloudflare preview` and open both pictures there. If the fonts don't load in the Worker, load them another way that does (e.g. the `ASSETS` binding from `public/`; then add the files to the proxy matcher's skip list, see `src/proxy.ts`'s `config`). Note the Worker's size before (build `dev` HEAD first) and after.
- [ ] **Step 7: Commit** — `feat: QuizMatter title card for shared links, site picture and robots.txt`.

### Task 6: Words, Privacy Policy and notes

**Files:**
- Modify: `src/components/editor/ShareButton.tsx` (the Published explanation; and where a QuizMatter lesson's Draft / Shared switch explains sharing, find it with Grep "Shared")
- Modify: `src/app/(legal)/privacy/page.tsx` (section 4, lines 122-128), `src/app/(legal)/terms/page.tsx` (only if it says pages are closed), `src/lib/legal.ts` (`LEGAL_VERSION = "2026-11-20"`)
- Modify: `src/app/CLAUDE.md`, `CLAUDE.md` (map: `src/proxy.ts` line), `supabase/migrations/CLAUDE.md` (anon may also call `public_presentation`)

- [ ] **Step 1: Share line** exact words from Global Constraints, under Published.
- [ ] **Step 2: Privacy Policy** section 4: replace "QuizMatter’s pages are closed to everyone else, except …" so it says that anyone with the link, and search engines, can see a published presentation's title, description, subject, grades, Author (or display name), number of slides and first slide; everything else stays logged-in only. Same plain style.
- [ ] **Step 3: Notes.** `src/app/CLAUDE.md`: a "Public preview" bullet under "A presentation's pages" (who sees what, `public_presentation`, `publicPresentation.ts`, the pictures, robots.ts) and update the login/proxy bullet; root map's `src/proxy.ts` line; migrations notes' anon list.
- [ ] **Step 4: Check** `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** — `docs: public preview in the Privacy Policy, Share card and notes`.

### Task 7: Browser test and final checks

**Files:**
- Create: `e2e/public-preview.mjs` (reuse `e2e/lib.mjs`; read `e2e/CLAUDE.md` first)

- [ ] **Step 1: Write the test.** Make a teacher and, as postgres (`psql`), one published presentation with two slides (first hidden), one private, one published + hidden. Logged out (a fresh browser context):
  - published: `h1` text = title; the main button reads "Log in to see the slide" (1 shown slide; for n > 1 it's "Log in to see all <n> slides", set this in Task 4 Step 3); `meta[property="og:title"]`, `meta[property="og:image"]` starting with `https://`, `meta[name="twitter:card"]` = `summary_large_image`; fetching the og:image path on `APP` answers `content-type: image/png`.
  - private and hidden ones: final URL is `/login?next=…`.
  - Logged in as another teacher (`loggedIn`): the same published link shows the normal view page (e.g. its Save button), not the login buttons.
- [ ] **Step 2: Run** `npm run e2e:dev` then `node e2e/public-preview.mjs` → all checks pass; also re-run `node e2e/proxy.mjs`.
- [ ] **Step 3: Full checks** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:sql`; read `git diff main...dev` next to the spec.
- [ ] **Step 4: Commit** — `test: public preview browser test`.
- [ ] **Step 5: Tell the user** the deploy order: paste `20261231002200_public_presentation.sql` into the live SQL editor first, then push `dev`; check a link in Facebook's Sharing Debugger on the preview.
