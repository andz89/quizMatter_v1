# Remove the Photo Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every photo an admin adds through Claude is ready at once; the "waiting for review" step is gone from Claude's tools, the admin page, the editor's photo panel and the database.

**Architecture:** Three independent removals: (1) Claude's upload path drops `approved` / `for_presentation`; (2) the admin page and editor photo loading stop reading `approved` / `waiting`; (3) a migration drops the column and rebuilds the policy, views and search function without it. Code (1)+(2) works with the column still there, so it deploys first and the migration runs after.

**Tech Stack:** Next.js 16, React 19, TypeScript, zod 4, Supabase (Postgres), Cloudflare D1 (tickets). No new packages.

**Spec:** `docs/superpowers/specs/2026-10-07-remove-photo-review-design.md`

## Global Constraints

- No code may read or write `shared_photos.approved` or `shared_photo_counts.waiting` after Tasks 1–2 (the migration removes them).
- Presentation reviews (`presentation_reviews`, `ReviewersModal`, `admin/presentations`) also say "approved" — a different feature. Don't touch it.
- Zod-before-saving stays as it is for every insert/update that remains.
- Design system and the one `Spinner` stay; only remove UI, don't restyle what's left.
- The project has no test runner; each task is checked with `npx tsc --noEmit`, `npx eslint <changed files>`, and a `grep` for leftovers. Live testing is the user's.
- Commit after each task. **Don't push** — the user pushes; deploy order is code first, migration after.

## Review Focus

1. A link with `?missing=review` (old bookmark) → the admin page opens on "Anything" instead of erroring. `photoSearchSchema` uses `.catch`, so removing the option is enough. Task 2, Step 5 grep + read.
2. A ticket made before deploy that still has `approved` in its JSON → upload works; `claudePhotoSchema` drops the key. Task 1, Step 1.
3. The editor's Photos panel category chips still show every category that has photos (no `waiting` subtraction). Task 2, Step 4.
4. Migration order: the policy and `search_shared_photos` stop using `approved` before the column is dropped; views dropped before the column and recreated after. Task 3, Step 1.
5. No leftover `approveSharedPhotos`, `waitingSrcs`, `for_presentation`, `.eq("approved"` in `src/`. Task 2, Step 5 grep.

---

### Task 1: Claude's upload — always ready, no `for_presentation`

**Files:**
- Modify: `src/lib/photoTickets.ts`
- Modify: `src/app/api/claude-photo/route.ts`
- Modify: `src/pages/api/mcp.ts` (`prepare_photo_upload`, `checkPhotos`)
- Modify: `src/lib/importPresentation.ts` ("Real photos" notes)
- Modify: `src/app/api/upload-image/route.ts` (admin upsert)

**Interfaces:**
- Produces: `PhotoTicket = { ownerId: string; details: ClaudePhotoDetails }`; `createPhotoTickets(ownerId: string, photos: ClaudePhotoDetails[]): Promise<string[]>`.

- [ ] **Step 1: Tickets** — in `photoTickets.ts`: type back to `{ ownerId: string; details: ClaudePhotoDetails }`; `createPhotoTickets(ownerId, photos)` with the one-line doc comment "Stores a ticket for each photo and returns their ids, in the same order. Also clears out expired tickets."; insert binds `JSON.stringify(photo)`; `getPhotoTicket` returns `row ? { ownerId: row.owner_id, details: JSON.parse(row.details) } : null`. (An old ticket with `approved` in its JSON is fine: the route's `claudePhotoSchema.safeParse` drops unknown keys.)

- [ ] **Step 2: Route** — in `claude-photo/route.ts`:
  - Top comment: replace the review sentences with "It's ready for teachers and slides at once."
  - Existing-photo block becomes:

```ts
  // The same photo is already shared: it's left as it is (an admin may have changed its details). Its size comes
  // back so it can go on slides.
  const { data: existing, error: existingError } = await supabase
    .from("shared_photos")
    .select("file_name, width, height")
    .eq("src", src)
    .maybeSingle();
  if (existingError) return answer(500, "Couldn't add the photo. Send it again.");
  if (existing) {
    await deletePhotoTicket(ticketId.data);
    return answer(200, `This photo is already in the library, as "${existing.file_name}". Nothing was changed.`, {
      src,
      width: existing.width,
      height: existing.height,
    });
  }
```

  - Insert: `.insert({ ...photo.data, ...info, bytes: sharedPhotoBytesSchema.parse(body.byteLength) })`.
  - Success: `return answer(200, \`${added}. It can go on slides now.\`, { src, width: size.width, height: size.height });` (remove `review`).

- [ ] **Step 3: MCP tool** — in `mcp.ts`, `prepare_photo_upload`:
  - Description: replace the last sentence (`'Set "for_presentation": true …'`) with `"The photos are ready at once: teachers can find them, and you can put them on slides."` (keep the "+" joins and the zip sentence).
  - `inputSchema: { photos: z.array(claudePhotoSchema).min(1).max(20).describe("One entry per photo, in the order you'll upload them.") },`
  - Handler: `async ({ photos }) => { const ids = await createPhotoTickets(userId, photos);`
  - Replace the `...(approved ? [...] : [...])` block with:

```ts
        "When you're done, tell the user which photos were added. To put one on a slide, use",
        '{ "asset": "photo", "photo": { "src", "width", "height" } } in "elements", copied exactly from its upload answer.',
```

  - `checkPhotos`: remove `// Photos waiting for review…` and `.eq("approved", true)`; doc comment "Every photo on the slides must be a shared photo, with its real size (as find_photos or the upload answer gave it). The problems, if any."; message `` `${photo.src} isn't a shared photo. Only use photos from find_photos, or ones you uploaded with prepare_photo_upload.` ``.

- [ ] **Step 4: Notes** — in `importPresentation.ts`: `…or ones you just uploaded with prepare_photo_upload (copy "src", "width" and "height" from its upload answer): any other photo is refused.` and in the zip bullet `upload the zip's photos with prepare_photo_upload (ask the user…`. No backticks or `${` (template literal).

- [ ] **Step 5: Admin upload** — in `upload-image/route.ts`: comment "Its file size too, for the admin page."; upsert `{ ...shared.data, bytes: sharedPhotoBytesSchema.parse(body.byteLength), created_at }`.

- [ ] **Step 6: Check** — `npx tsc --noEmit` → 0 errors; `npx eslint` on the 5 files → clean; `grep -rn "for_presentation\|approved" src/lib/photoTickets.ts src/app/api src/pages/api/mcp.ts src/lib/importPresentation.ts` → nothing.

- [ ] **Step 7: Commit** — `git add` the 5 files; message "Make every Claude photo upload ready at once".

### Task 2: Admin page and editor — no review UI

**Files:**
- Modify: `src/app/admin/photoSearch.ts`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/AdminPhotos.tsx`
- Modify: `src/lib/photos.tsx`

- [ ] **Step 1: Search options** — `photoSearch.ts`: remove the `review` entry and its comment from `MISSING`.

- [ ] **Step 2: page.tsx** — counts select `"category_id, photos, no_description, no_source"`; remove `waitingSrcs` and its line; `PhotoCounts` init without `waiting`; remove `counts.waiting += row.waiting;`; remove the `waitingSrcs={waitingSrcs}` prop; photos select `` `${SHARED_PHOTO_COLUMNS}, bytes` `` with comment "With each photo's file size, which only this page needs (see SHARED_PHOTO_COLUMNS)."; remove `if (search.missing === "review") query = query.eq("approved", false);`.

- [ ] **Step 3: AdminPhotos.tsx**
  - `PhotoCounts = { total: number; byCategory: Record<string, number>; noDescription: number; noSource: number }`, comment "…in each category, and missing a description or source."
  - Remove `approveSharedPhotos` and `CheckIcon` imports.
  - `AdminPhotos`: remove `waitingSrcs` from props, type and the `<PhotosCard waitingSrcs=…>`.
  - `PhotosCard`: remove `waitingSrcs` prop/type, `approvingSrcs` state + comment, the `review` chip, `handleApprove`, `isApprovingAll`, the `search.missing === "review"` approve-all box, and `isWaiting` / `isApproving` / `onApprove` on `<SharedPhotoItem>`. Comments: drop "or waiting for review (Claude's uploads)" / "or waiting for review" / "be approved, ".
  - `SharedPhotoItem`: remove `isWaiting`, `isApproving`, `onApprove` (props + types), `waitingPill`, `approveButton`, and their three uses in the JSX; doc comment drops the last sentence.

- [ ] **Step 4: photos.tsx** — `loadPhotoCategoriesInUse`: select `"category_id, photos"`, and

```ts
    const inUse = new Set(counts.data.filter((row) => row.photos > 0).map((row) => row.category_id));
```

  (drop the "waiting" comment). `fetchSharedPhotoPage`: `let query = createClient().from("shared_photos_search").select(SHARED_PHOTO_COLUMNS);` and drop its comment. Remove `approveSharedPhotos` and its doc comment; remove any import that becomes unused.

- [ ] **Step 5: Check** — `npx tsc --noEmit` → 0; `npx eslint` on the 4 files → clean; `grep -rn "approveSharedPhotos\|waitingSrcs\|\.waiting\|\"review\"\|eq(\"approved\"" src` → nothing (presentation-review hits are a different feature; read each hit).

- [ ] **Step 6: Commit** — "Remove the photo review from Admin → Photos and the Photos panel".

### Task 3: Migration and docs

**Files:**
- Create: `supabase/migrations/20261026000000_remove_photo_review.sql`
- Modify: `docs/superpowers/specs/2026-10-07-zip-to-presentation-design.md` (note at the top)
- Modify: `CLAUDE.md` only if it mentions the photo review (grep first)

- [ ] **Step 1: Migration**

```sql
-- Every photo is ready at once now, including Claude's uploads: the review from 20261005000000_photo_review.sql
-- is removed. Photos still waiting simply become normal photos.

-- Teachers read every shared photo again (as in 20260928020000_shared_photos.sql).
drop policy "Everyone reads approved shared photos" on public.shared_photos;
create policy "Everyone reads shared photos" on public.shared_photos
  for select to authenticated using (true);

-- The same search, over every photo.
create or replace function public.search_shared_photos(query text)
returns table (src text, width integer, height integer, file_name text, category text, description text, tags text[], source text)
language sql
stable
security invoker
set search_path = ''
as $$
  select sp.src, sp.width, sp.height, sp.file_name, c.name, sp.description, sp.tags, sp.source
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id
  cross join lateral (
    -- Split into words (letters and digits only, so % and _ can't act as wildcards).
    select count(*) as hits
    from unnest(regexp_split_to_array(lower(query), '[^[:alnum:]]+')) as w (word)
    where w.word <> ''
      and (
        lower(sp.description) like '%' || w.word || '%'
        or lower(sp.file_name) like '%' || w.word || '%'
        or lower(c.name) like '%' || w.word || '%'
        or exists (select 1 from unnest(sp.tags) as t (tag) where lower(t.tag) like '%' || w.word || '%')
      )
  ) as m
  where m.hits > 0 or trim(query) = ''
  order by m.hits desc, sp.created_at desc
  limit 20;
$$;

-- A view can't lose a column with "create or replace", so both are made again without it.
drop view public.shared_photos_search;
drop view public.shared_photo_counts;

alter table public.shared_photos drop column approved;

create view public.shared_photos_search with (security_invoker = true) as
  select
    sp.src,
    sp.width,
    sp.height,
    sp.category_id,
    sp.file_name,
    sp.description,
    sp.tags,
    sp.source,
    sp.bytes,
    sp.created_at,
    array_to_string(sp.tags, ' ') as tags_text,
    c.name as category_name
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id;

create view public.shared_photo_counts with (security_invoker = true) as
  select
    category_id,
    count(*)::integer as photos,
    (count(*) filter (where description = ''))::integer as no_description,
    (count(*) filter (where source = ''))::integer as no_source
  from public.shared_photos
  group by category_id;
```

  Before writing it, check the original migrations for grants on the views (`grep -n "grant" supabase/migrations/2026100*`): if the views had grants, repeat them after `create view`.

- [ ] **Step 2: Docs** — at the top of `2026-10-07-zip-to-presentation-design.md`, under the title: `> **Changed:** \`for_presentation\` was removed — every photo Claude uploads is ready at once. See \`2026-10-07-remove-photo-review-design.md\`.` `grep -n "review\|Waiting" CLAUDE.md` for photo-review lines; update any.

- [ ] **Step 3: Commit** — "Add migration removing the photo review".
