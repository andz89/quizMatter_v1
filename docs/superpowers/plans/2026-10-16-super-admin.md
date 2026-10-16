# Super Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split admins into one super admin (andzrivero89@gmail.com, can do everything) and plain admins (Photos
— their own only —, Presentations, Reports, Editors; no Teachers, Safety, Photo cleanup).

**Architecture:** A new `admins.is_super` flag and `is_super_admin()` database function. Database rules that only
the super admin may pass switch from `is_admin()` to `is_super_admin()`; shared photos get an `uploaded_by` owner
used by their policies. The app reads `isSuperAdmin` from `getAccount()` to hide menu items, block pages and refuse
server actions.

**Tech Stack:** Next.js (app router, server actions), Supabase (Postgres RLS + plpgsql), zod, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-16-super-admin-design.md`

## Global Constraints

- The super admin is found by the email `andzrivero89@gmail.com` **only in the migration**; the app never writes it.
- Plain admins stay admins: `is_admin()` is unchanged and still true for them.
- Every admin (plain too) keeps skipping the 50-presentation limit (`check_presentation_limit`).
- Only the super admin skips `count_write`, `count_click` and the 30-day display-name wait.
- Every presentation an admin makes stays a QuizMatter one (`from_admin`, Author "QuizMatter") — no change there.
- Migrations: new file, later date than `20261121000000`, `set search_path = ''`, full names, start each changed
  function from its **newest** version (see `supabase/migrations/CLAUDE.md`).
- Design system: existing classes only. No new packages.
- No test framework in this repo: each task is checked with `npx tsc --noEmit` and ESLint on the changed files.
  Live testing is left to the user.
- **Commits:** work is on `main`; ask the user before every commit.

## Review Focus

1. A plain admin uploads (Admin → Photos) a photo another admin already shared → the photo is not moved, retitled
   or taken over; the upload still "works". The follow-up description/tags save may show the existing toast "A
   photo was uploaded, but its description or tags couldn't be saved" — acceptable, it's not theirs.
2. A plain admin uploads more than 30 shared photos within a minute → `count_write` now refuses them with QM429
   ("You're adding photos too fast"), as agreed. Mention this to the user at the end.
3. A plain admin types `/admin/teachers`, `/admin/safety`, `/admin/safety/history` or `/admin/cleanup` → "page not
   found"; calling `banTeacher` / `unbanTeacher` / `releasePause` / `findCleanupFiles` / `/api/delete-photo` is refused.
4. A plain admin removes an editor on Admin → Editors → still works (`setEditor` stays admin-level).
5. A plain admin approves a submission or publishes a review → still works (security definer functions, 50-limit
   still skipped).

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/20261122000000_super_admin.sql`

**Interfaces:**
- Produces: `public.is_super_admin() returns boolean` (rpc `"is_super_admin"`), column `admins.is_super`, column
  `shared_photos.uploaded_by uuid` (default `auth.uid()`), view columns `shared_photos_search.uploaded_by` and
  `shared_photo_counts.uploaded_by` (counts now one row per category **and** uploader).

- [ ] **Step 1: Write the file — header, flag and function**

```sql
-- Super admin and plain admins (docs/superpowers/specs/2026-10-16-super-admin-design.md).
-- One admin is the super admin and can do everything. Every other admin is a plain admin: still an admin
-- (is_admin() is true), but can't manage teachers, safety or the photo cleanup, only manages the shared photos
-- they uploaded, and follows the speed limits like a teacher. Every admin still skips the 50-presentation limit,
-- because approving a submission makes a copy the approving admin owns.

-- ─── 1. The super admin ─────────────────────────────────────────────────────────────────────────────────────
alter table public.admins add column is_super boolean not null default false;

update public.admins set is_super = true
where user_id = (select id from auth.users where email = 'andzrivero89@gmail.com');

-- True when the logged-in user is the super admin. "security definer" lets it read the admins table.
create function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()) and is_super);
$$;

revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;
```

- [ ] **Step 2: Shared photo owners, views and policies**

```sql
-- ─── 2. Shared photos: who uploaded each one ────────────────────────────────────────────────────────────────
-- Filled by the database for uploads from Admin → Photos, and by claude-photo (from the ticket) for Claude's.
-- The photos shared before this were all uploaded by the super admin.
alter table public.shared_photos
  add column uploaded_by uuid default auth.uid() references auth.users (id) on delete set null;

update public.shared_photos
set uploaded_by = (select user_id from public.admins where is_super limit 1);

-- Same views as in 20261026000000_remove_photo_review.sql, plus uploaded_by (added last, so "create or replace"
-- works). The counts are now one row per category and uploader, so Admin → Photos can count only an admin's own.
create or replace view public.shared_photos_search with (security_invoker = true) as
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
    c.name as category_name,
    sp.uploaded_by
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id;

create or replace view public.shared_photo_counts with (security_invoker = true) as
  select
    category_id,
    count(*)::integer as photos,
    (count(*) filter (where description = ''))::integer as no_description,
    (count(*) filter (where source = ''))::integer as no_source,
    uploaded_by
  from public.shared_photos
  group by category_id, uploaded_by;

-- Everyone still reads every shared photo. Any admin adds them (as themselves); the super admin changes or removes
-- any, a plain admin only their own.
drop policy "Admins change shared photos" on public.shared_photos;
create policy "Admins add shared photos" on public.shared_photos
  for insert to authenticated
  with check ((select public.is_admin()) and uploaded_by = (select auth.uid()));
create policy "Owners change shared photos" on public.shared_photos
  for update to authenticated
  using ((select public.is_super_admin()) or ((select public.is_admin()) and uploaded_by = (select auth.uid())))
  with check ((select public.is_super_admin()) or ((select public.is_admin()) and uploaded_by = (select auth.uid())));
create policy "Owners remove shared photos" on public.shared_photos
  for delete to authenticated
  using ((select public.is_super_admin()) or ((select public.is_admin()) and uploaded_by = (select auth.uid())));

-- Any admin makes a new category (when uploading); only the super admin renames or deletes one.
drop policy "Admins change categories" on public.photo_categories;
create policy "Admins add categories" on public.photo_categories
  for insert to authenticated
  with check ((select public.is_admin()));
create policy "Super admin changes categories" on public.photo_categories
  for update to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));
create policy "Super admin removes categories" on public.photo_categories
  for delete to authenticated
  using ((select public.is_super_admin()));
```

- [ ] **Step 3: Super-admin-only pages' data**

```sql
-- ─── 3. Bans and the photo cleanup: super admin only ────────────────────────────────────────────────────────
drop policy "Admins manage bans" on public.banned_users;
create policy "Super admin manages bans" on public.banned_users
  for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

-- Same as before (20260929000000_admin_used_photos.sql), for the super admin only.
create or replace function public.admin_used_photo_srcs()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can see this.' using errcode = '42501';
  end if;
  return public.used_photo_srcs();
end;
$$;
```

Before writing the bans policy, open `supabase/migrations/20261009000000_banned_users.sql` lines 14-20 and check the
old policy's name and `for` clause; copy them exactly in the `drop policy` line and keep the same `for` clause.

- [ ] **Step 4: Speed limits — only the super admin skips them**

```sql
-- ─── 4. Speed limits: only the super admin skips them ───────────────────────────────────────────────────────
-- count_write: same as before (20261012000000_saved_limits.sql); only is_super_admin() is new.
create or replace function public.count_write(kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  user_writes int;
begin
  if count_write.kind not in ('presentations', 'photos', 'saved') then
    raise exception 'Unknown kind of write.' using errcode = '22023';
  end if;
  if auth.uid() is null or public.is_super_admin() then
    return;
  end if;
  if exists (select 1 from public.banned_users where user_id = auth.uid()) then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;

  insert into public.write_rate as w (user_id, kind, window_start, writes)
  values (auth.uid(), count_write.kind, now(), 1)
  on conflict (user_id, kind) do update set
    window_start = case when w.window_start < now() - interval '1 minute' then now() else w.window_start end,
    writes = case when w.window_start < now() - interval '1 minute' then 1 else w.writes + 1 end
  returning w.writes into user_writes;

  if user_writes > 30 then
    raise exception 'Too many saves. Wait a minute and try again.' using errcode = 'QM429';
  end if;
end;
$$;
```

Then add `count_click` and `set_display_name`:

1. Copy the whole `create or replace function public.count_click(feature text) … $$;` block **verbatim** from
   `supabase/migrations/20261105000000_publish_daily_reset.sql` (its newest version). Put this comment above it:
   `-- count_click: same as before (20261105000000_publish_daily_reset.sql); only is_super_admin() is new.`
   Change exactly one line: `if auth.uid() is null or public.is_admin() then` →
   `if auth.uid() is null or public.is_super_admin() then`.
2. Copy the whole `create function public.set_display_name(name text) … $$;` block verbatim from
   `supabase/migrations/20261113000000_display_name_rules.sql`, change `create function` to
   `create or replace function`, add the comment
   `-- set_display_name: same as before (20261113000000_display_name_rules.sql); only is_super_admin() is new.`
   and change exactly one line: `if not public.is_admin() and changed_at > now() - interval '30 days' then` →
   `if not public.is_super_admin() and changed_at > now() - interval '30 days' then`.
   Check with a search that neither is redefined in a later file first:
   `grep -l "function public.count_click(\|function public.set_display_name(" supabase/migrations/*.sql`.

- [ ] **Step 5: Check the file**

Run: `grep -n "is_admin()\|is_super_admin()" supabase/migrations/20261122000000_super_admin.sql`
Expected: `is_super_admin()` in the function, policies, `admin_used_photo_srcs`, `count_write`, `count_click`,
`set_display_name`; `is_admin()` only in the "Admins add …" and "Owners …" policies.

- [ ] **Step 6: Apply**

Ask the user before applying to the live database. On a yes, apply it with the Supabase MCP `apply_migration`
(name `super_admin`, the file's SQL), then run
`select user_id, is_super from public.admins;` with `execute_sql`. Expected: exactly one row with `is_super = true`.

---

### Task 2: `isSuperAdmin`, the menu, blocked pages and actions

**Files:**
- Modify: `src/lib/account.ts`
- Modify: `src/app/admin/layout.tsx`, `src/app/admin/AdminMenu.tsx`
- Modify: `src/app/admin/teachers/page.tsx`, `src/app/admin/teachers/actions.ts`
- Modify: `src/app/admin/safety/page.tsx`, `src/app/admin/safety/history/page.tsx`, `src/app/admin/safety/actions.ts`
- Modify: `src/app/admin/cleanup/page.tsx`, `src/app/admin/cleanup/actions.ts`
- Modify: `src/app/api/delete-photo/route.ts`

**Interfaces:**
- Consumes: rpc `is_super_admin` (Task 1).
- Produces: `Account.isSuperAdmin: boolean`; `AdminMenu({ isSuperAdmin }: { isSuperAdmin: boolean })`.

- [ ] **Step 1: `getAccount()`**

In `src/lib/account.ts`, add to the `Account` type after `isAdmin: boolean;`:

```ts
  // The one admin who can do everything (admins.is_super). Plain admins can't manage teachers, safety or the
  // photo cleanup, and only manage the shared photos they uploaded.
  isSuperAdmin: boolean;
```

Add `{ data: isSuperAdmin }` to the destructured `Promise.all` result and `supabase.rpc("is_super_admin"),` right
after `supabase.rpc("is_admin"),`. Return `isSuperAdmin: isSuperAdmin === true,` after `isAdmin`. Change the
`nextNameChangeAt` line to use `isSuperAdmin !== true` instead of `isAdmin !== true` (only the super admin skips the
30-day wait now), and update the type's comment: "(always null for the super admin)".

- [ ] **Step 2: The menu**

`src/app/admin/AdminMenu.tsx`:

```tsx
// The admin pages. `superOnly` ones are only for the super admin (plain admins don't see them).
const ITEMS = [
  { href: "/admin", label: "Photos" },
  { href: "/admin/presentations", label: "Presentations" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/teachers", label: "Teachers", superOnly: true },
  { href: "/admin/editors", label: "Editors" },
  { href: "/admin/safety", label: "Safety", superOnly: true },
  { href: "/admin/cleanup", label: "Photo cleanup", superOnly: true },
];
```

Change the signature to `export function AdminMenu({ isSuperAdmin }: { isSuperAdmin: boolean })` and map over
`ITEMS.filter((item) => isSuperAdmin || !item.superOnly)`. In `layout.tsx`: `const { isAdmin, isSuperAdmin } =
await getAccount();` and render `<AdminMenu isSuperAdmin={isSuperAdmin} />`.

- [ ] **Step 3: Blocked pages**

In `teachers/page.tsx`, `safety/page.tsx`, `safety/history/page.tsx`, `cleanup/page.tsx` change the check
`if (!(await getAccount()).isAdmin) notFound();` to `if (!(await getAccount()).isSuperAdmin) notFound();`
(in `safety/page.tsx` and `history/page.tsx` the check is on the line shown by
`grep -n "isAdmin" src/app/admin/safety -r`).

- [ ] **Step 4: Refused actions**

- `teachers/actions.ts`: in `banTeacher`, `if (!account.isSuperAdmin) return "Only the super admin can ban teachers.";`;
  in `unbanTeacher`, `if (!(await getAccount()).isSuperAdmin) return "Only the super admin can unban teachers.";`.
  **Leave `setEditor` on `isAdmin`** — Admin → Editors uses it for plain admins.
- `safety/actions.ts` `releasePause`: `if (!(await getAccount()).isSuperAdmin) return "Only the super admin can release teachers.";`
- `cleanup/actions.ts`: every `isAdmin` check → `isSuperAdmin` (`grep -n isAdmin src/app/admin/cleanup/actions.ts`),
  and its comment "Admins only" → "Super admin only".
- `api/delete-photo/route.ts`: `const { data: isSuperAdmin } = await supabase.rpc("is_super_admin");` and
  `if (isSuperAdmin !== true) return Response.json({ error: "Only the super admin can delete photos." }, { status: 403 });`;
  comment "Admins only" → "Super admin only".

- [ ] **Step 5: Check**

Run: `npx tsc --noEmit` then `npx eslint src/lib/account.ts src/app/admin src/app/api/delete-photo`
Expected: no errors.

- [ ] **Step 6: Ask the user, then commit**

```bash
git add supabase/migrations/20261122000000_super_admin.sql src/lib/account.ts src/app/admin src/app/api/delete-photo
git commit -m "Super admin: plain admins can't manage teachers, safety or the photo cleanup"
```

---

### Task 3: Shared photos — each admin manages their own

**Files:**
- Modify: `src/app/api/upload-image/route.ts`
- Modify: `src/app/api/claude-photo/route.ts`
- Modify: `src/app/admin/page.tsx`, `src/app/admin/AdminPhotos.tsx`
- Modify: `src/lib/photos.tsx` (`removeSharedPhoto`)

**Interfaces:**
- Consumes: `Account.isSuperAdmin` (Task 2); `shared_photos.uploaded_by`, view column `uploaded_by` (Task 1).
- Produces: `AdminPhotos` gets a new prop `isSuperAdmin: boolean`.

- [ ] **Step 1: `upload-image` doesn't take over someone else's photo**

In `src/app/api/upload-image/route.ts`, right before `await savePhotoFile(fileName, body, type);` add:

```ts
  // A photo another admin already shared stays as it is (its category, name and owner): a plain admin just gets it
  // back to use. The super admin's upload moves it, as before. (The database refuses the change anyway.)
  if (shared) {
    const [{ data: existing }, { data: isSuperAdmin }] = await Promise.all([
      supabase.from("shared_photos").select("uploaded_by").eq("src", shared.data.src).maybeSingle(),
      supabase.rpc("is_super_admin"),
    ]);
    if (existing && existing.uploaded_by !== data.claims.sub && isSuperAdmin !== true) return Response.json(photo.data);
  }
```

The upsert sends no `uploaded_by`: a new row gets the database default (the uploader); an existing row keeps its
owner. Add to the top comment: "Each shared photo remembers who uploaded it (uploaded_by, filled by the database)."

- [ ] **Step 2: `claude-photo` saves the owner**

In `src/app/api/claude-photo/route.ts`, the insert becomes:

```ts
      .insert({ ...photo.data, ...info, bytes: sharedPhotoBytesSchema.parse(body.byteLength), uploaded_by: ticket.ownerId });
```

(It uses the secret key, so `auth.uid()` is empty there; the ticket's `ownerId` is the admin who asked Claude.)
`ticket.ownerId` comes from our own D1 row written by `prepare_photo_upload` with the logged-in user's id; it is a
uuid already. Update the top comment: "…which only admins can call) holds the photo's name, …, and who asked (the
photo's uploaded_by)".

- [ ] **Step 3: Admin → Photos shows a plain admin only their own**

In `src/app/admin/page.tsx`:

```ts
  const account = await getAccount();
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!account.isAdmin) notFound();
  // A plain admin sees only the shared photos they uploaded; the super admin sees them all.
  const ownerId = account.isSuperAdmin ? null : account.id;
```

Pass `ownerId` to `findPhotos(supabase, search, ownerId)` and `findPhotos(supabase, search, ownerId, true)`;
change its signature to `function findPhotos(supabase: Supabase, search: PhotoSearch, ownerId: string | null, countOnly = false)`
and right after `let query = …` add `if (ownerId) query = query.eq("uploaded_by", ownerId);`.

The counts query becomes:

```ts
    (() => {
      const counts = supabase.from("shared_photo_counts").select("category_id, photos, no_description, no_source");
      return ownerId ? counts.eq("uploaded_by", ownerId) : counts;
    })(),
```

and, since the view now has a row per category **and** uploader, the loop adds instead of sets:

```ts
    counts.byCategory[row.category_id] = (counts.byCategory[row.category_id] ?? 0) + row.photos;
```

Pass `isSuperAdmin={account.isSuperAdmin}` to `<AdminPhotos …>`. Update the page comment: "A plain admin sees only
the photos they uploaded."

- [ ] **Step 4: Categories button only for the super admin**

In `src/app/admin/AdminPhotos.tsx`, add `isSuperAdmin` to the props (type `isSuperAdmin: boolean;` with comment
`// Only the super admin renames or deletes categories (plain admins make new ones when uploading).`). Wrap the
"Categories" button in `{isSuperAdmin && ( … )}`.

- [ ] **Step 5: Removing a photo that isn't yours fails loudly**

In `src/lib/photos.tsx`:

```ts
/** Takes a photo off the shared list. Slides that use it keep it (the file stays). Throws if it fails or wasn't removed. */
export async function removeSharedPhoto(src: string) {
  // The removed row is asked back: the database rules skip a blocked delete (a plain admin's, of someone else's photo) without an error.
  const { data, error } = await createClient().from("shared_photos").delete().eq("src", src).select("src");
  if (error) throw error;
  if (data.length === 0) throw new Error("The photo wasn't removed.");
}
```

- [ ] **Step 6: Check**

Run: `npx tsc --noEmit` then `npx eslint src/app/api/upload-image src/app/api/claude-photo src/app/admin/page.tsx src/app/admin/AdminPhotos.tsx src/lib/photos.tsx`
Expected: no errors.

- [ ] **Step 7: Ask the user, then commit**

```bash
git add src/app/api/upload-image src/app/api/claude-photo src/app/admin/page.tsx src/app/admin/AdminPhotos.tsx src/lib/photos.tsx
git commit -m "Shared photos remember who uploaded them; plain admins manage only their own"
```

---

### Task 4: Presentations — no "+ New presentation" or "Move to QuizMatter" for plain admins

**Files:**
- Modify: `src/app/admin/presentations/page.tsx:82`
- Modify: `src/app/admin/presentations/actions.ts` (`moveToQuizMatter`)
- Modify: `src/app/(home)/page.tsx:60`, `src/app/(home)/search/page.tsx:101`, `src/app/(home)/cards.ts`

**Interfaces:**
- Consumes: `Account.isSuperAdmin` (Task 2).
- Produces: `myCard(p, canMoveToQuizMatter: boolean, now, extra)` — second parameter renamed.

- [ ] **Step 1: Hide the button**

`src/app/admin/presentations/page.tsx`: `{account.isSuperAdmin && <NewPresentationButton author={QUIZMATTER_NAME} fromAdmin />}`
(with comment `{/* Plain admins make presentations from the home page or with Claude. */}`).

- [ ] **Step 2: Move to QuizMatter**

In `cards.ts`, rename `myCard`'s second parameter `isAdmin` to `canMoveToQuizMatter` and use
`canMoveToQuizMatter,` in the returned object. In `(home)/page.tsx` and `(home)/search/page.tsx`, pass
`account.isSuperAdmin` instead of `account.isAdmin` to `myCard`, and add `isSuperAdmin: boolean` to the `account`
parameter types there (`{ isAdmin: boolean; isEditor: boolean }` → `{ isAdmin: boolean; isSuperAdmin: boolean; isEditor: boolean }`).
In `moveToQuizMatter`: `if (!parsed.success || !(await getAccount()).isSuperAdmin) return false;` and its comment
"Only admins" → "Only the super admin".

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit` then `npx eslint "src/app/(home)" src/app/admin/presentations`
Expected: no errors.

- [ ] **Step 4: Ask the user, then commit**

```bash
git add "src/app/(home)" src/app/admin/presentations
git commit -m "Only the super admin moves presentations to QuizMatter or uses + New presentation in Admin"
```

---

### Task 5: Notes

**Files:**
- Modify: `CLAUDE.md` (root), `src/app/admin/CLAUDE.md`, `src/app/api/CLAUDE.md`, `supabase/migrations/CLAUDE.md`

- [ ] **Step 1: Root `CLAUDE.md`** — add after "# Submit to QuizMatter" section:

```markdown
# Super Admin (one admin who can do everything)

Admins are split in two. Full design: `docs/superpowers/specs/2026-10-16-super-admin-design.md`.

- **Super admin:** `admins.is_super` (set for andzrivero89@gmail.com in `20261122000000_super_admin.sql`), asked
  with `is_super_admin()` in the database and `getAccount().isSuperAdmin` in the app.
- **Plain admins** (every other admin, `is_admin()` still true): Admin → Photos (only shared photos they uploaded,
  `shared_photos.uploaded_by`), Presentations (no "+ New presentation"), Reports, Editors. Not Teachers, Safety or
  Photo cleanup (hidden, "page not found", actions refuse). No "Move to QuizMatter". They make categories but can't
  rename or delete them. They follow the speed limits (`count_write`, `count_click`, the 30-day name wait); every
  admin still skips the 50-presentation limit (approving a submission makes a copy the admin owns).
- A new super-admin-only rule goes in the database with `is_super_admin()`, not only in the app.
```

- [ ] **Step 2: `src/app/admin/CLAUDE.md`** — under the intro bullets add:
  "- `AdminMenu` items with `superOnly` (Teachers, Safety, Photo cleanup) show only for the super admin; those pages
  and their actions check `isSuperAdmin`. Admin → Photos shows a plain admin only their own photos (`uploaded_by`)
  and hides Categories. See the root `CLAUDE.md`, "Super Admin"."
  and in the table, add "(super admin only)" to Teachers, Safety and Photo cleanup.

- [ ] **Step 3: `src/app/api/CLAUDE.md`** — table: `delete-photo/` "Who" → "Super admin"; `upload-image/` and
  `claude-photo/` "What it does": add "saves who uploaded a shared photo (`uploaded_by`); a plain admin's upload of a
  photo someone else shared leaves it as it is".

- [ ] **Step 4: `supabase/migrations/CLAUDE.md`** — in "Writing a migration", the callers list becomes
  "(`auth.uid()`, `public.is_admin()`, `public.is_super_admin()`, `public.is_editor()`)"; under "Where the big
  features live" add "- Super admin: `20261122000000_super_admin.sql`."

- [ ] **Step 5: Final checks**

Run: `npx tsc --noEmit`, `npm run lint` (if it runs out of memory, run `npx eslint` on every changed file), then
`git diff` against the spec. Tell the user what passed or failed and remind them of Review Focus item 2 (the 30
photos a minute limit for plain admins).

- [ ] **Step 6: Ask the user, then commit**

```bash
git add CLAUDE.md src/app/admin/CLAUDE.md src/app/api/CLAUDE.md supabase/migrations/CLAUDE.md docs/superpowers
git commit -m "Notes: super admin and plain admins"
```
