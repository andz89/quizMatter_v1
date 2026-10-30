# Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The super admin shows a modal and/or a top bar to chosen teachers on chosen pages, with a close-button
delay and a "show again" rule.

**Architecture:** Two tables and a handful of `security definer` functions hold every rule (matching, live window,
closed state). `maintenance_status()` also carries `announcements_key`, so the existing once-a-minute check tells
the app whether anything is live. A browser component (`AnnouncementsWatch`) asks `my_announcements()` only when
the key is filled, keeps the answer in sessionStorage, and shows what fits the current page. The admin page writes
through server actions (zod first) and a Tiptap editor.

**Tech Stack:** Next.js (this repo's version: read `node_modules/next/dist/docs/` before page/route code), Supabase
Postgres, zod, Tiptap 3 (+ `@tiptap/extension-link`, `@tiptap/extension-image`), Tailwind with the design system's
classes, Lucide icons, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-10-30-announcements-design.md`

## Global Constraints

- All database tests run on local Docker only: `npx -y supabase@latest db reset`, then
  `docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcements.sql`.
  Never on the live project.
- Packages only with `npx -y npm@10.9.2 install ...`; commit `package-lock.json` with `package.json`.
- zod parses every input right before each rpc. Limits live in the zod schema and the database (same numbers):
  name 1–100, `modal_html` ≤ 20,000, `bar_html` ≤ 1,000, close delays 0–60, ages 18–100, presentations 0–50,
  ≤ 20 words per word list, each word ≤ 60 characters, ≤ 20 announcements on and not ended.
- Super admin only for every admin function (`is_super_admin()` in the database, `getAccount().isSuperAdmin` in
  the app).
- Design system only (`bg-accent-soft`, `rounded-card`, `btn-press`, …). Lucide icons with `size`. The one
  `Spinner`, the one `Modal`, `ConfirmModal`, `LinkPending`, `loading.tsx`.
- Times are Philippine time (fixed `+08:00`; `manila_today()` in SQL).
- Each task updates the notes (`CLAUDE.md`) of the folders it touches, in the same commit.
- Plain English in notes and comments, short.

## Review Focus

- A teacher with an empty birthday / province / education must not match a filter on that detail, but must match
  when that filter is empty. (Test in Task 1.)
- An announcement that ends while a tab is open must not keep reappearing after the teacher closes it, and a
  `daily` one closed at 23:59 must show again at 00:00 Philippine time, not UTC. (Tests in Task 1 and Task 2.)
- Saved HTML with `<script>`, `onerror=`, a `javascript:` link, or an image from another site must render without
  any of them. (Test in Task 3.)
- A modal must not show while presenting fullscreen, and must show after fullscreen ends. (Manual check in Task 6.)
- With no live announcement, a page load makes no `my_announcements` request. (Manual check in Task 6, with the
  dev request counter.)

---

### Task 1: Database (tables, rules, functions) + SQL test

**Files:**
- Create: `supabase/migrations/20261221000000_announcements.sql`
- Create: `supabase/tests/announcements.sql`
- Modify: `supabase/migrations/CLAUDE.md`

**Interfaces:**
- Produces (SQL):
  - Table `public.announcements` with the spec's columns (`id uuid default gen_random_uuid()`, `name`, `is_on`,
    `starts_at`, `ends_at`, `show_modal`, `modal_html`, `modal_close_after`, `show_bar`, `bar_html`,
    `bar_close_after`, `repeat`, `pages`, `genders`, `age_min`, `age_max`, `provinces`, `town_words`,
    `education_levels`, `field_words`, `presentations_min`, `presentations_max`, `roles`, `created_by`,
    `created_at`, `updated_at`). Check constraints carry every limit.
  - Table `public.announcement_dismissals (announcement_id uuid references announcements on delete cascade,
    user_id uuid references auth.users on delete cascade, part text check (part in ('modal','bar')), closed_at
    timestamptz not null default now(), primary key (announcement_id, user_id, part))`.
  - RLS on for both, no policies.
  - `announcement_is_live(a public.announcements) returns boolean`
  - `announcement_matches(a public.announcements, uid uuid) returns boolean` (not granted to clients)
  - `save_announcement(a jsonb) returns uuid`: `a.id` null = insert. Keys = column names.
  - `set_announcement_on(target uuid, turn_on boolean) returns void`
  - `delete_announcement(target uuid) returns void`
  - `admin_announcements() returns table (… every column …, status text, matched int, closed_modal int,
    closed_bar int)`, newest first
  - `announcement_audience(a jsonb) returns int`
  - `my_announcements() returns table (id uuid, show_modal boolean, modal_html text, modal_close_after int,
    show_bar boolean, bar_html text, bar_close_after int, repeat text, pages text[], created_at timestamptz)`
  - `dismiss_announcement(target uuid, part text) returns void`
  - `maintenance_status()` also returns `'announcements_key'` (text or null)
  - Admin log: actions `announcement_saved`, `announcement_deleted`; target type `announcement`

- [ ] **Step 1: Write the failing test `supabase/tests/announcements.sql`**

  Same shape as `supabase/tests/maintenance.sql` (`begin` … `rollback`, `pg_temp.refused`, `raise exception
  'FAIL: …'`). Users: a1 super admin, a2 plain admin, t1 teacher (female, born 1990-01-01, Cebu, town "Mandaue
  City", master, field "Secondary Education, major in English", 3 own presentations + 1 shared copy), t2 teacher
  with every detail empty, e1 editor, b1 banned teacher (matches everything). Assertions:

  1. t1 and a2 can't call `save_announcement`, `set_announcement_on`, `delete_announcement`,
     `admin_announcements`, `announcement_audience`; t1 can't `select` from `announcements` or
     `announcement_dismissals`.
  2. a1 saves an empty-filter, modal-only `once` announcement on `{all}`: t1, t2, e1 each get 1 row from
     `my_announcements`; b1 gets 0; `maintenance_status()->>'announcements_key'` is not null.
  3. Filters, one at a time on that announcement (all other filters empty), t1 must match / must not match:
     - `genders {female}` ✓, `{male}` ✗;
     - `age_min 30, age_max 40` ✓ (age on `manila_today()`), `age_min 40` ✗;
     - `provinces {Cebu}` ✓, `{Bohol}` ✗;
     - `town_words {mandaue}` ✓ (case), `{lapu}` ✗;
     - `education_levels {master}` ✓, `{doctorate}` ✗;
     - `field_words {ENGLISH, filipino}` ✓, `{math}` ✗;
     - `presentations_min 3, presentations_max 3` ✓ (the shared copy is not counted), `presentations_min 4` ✗;
     - `roles {teacher}` ✓ for t1 and ✗ for e1, `roles {editor}` ✓ for e1.
  4. t2 (empty details) does not match `age_min 18`, `provinces {Cebu}`, `town_words {a}`,
     `education_levels {master}`, `field_words {a}`, `genders {female}`.
  5. Live window: `is_on false` → 0 rows; `starts_at` tomorrow → 0 rows and key null; `ends_at` an hour ago →
     0 rows and key null. The key changes after a save that changes `modal_html`.
  6. `once`: t1 calls `dismiss_announcement(id, 'modal')` → 0 rows for t1, still 1 for t2. A modal+bar
     announcement: dismissing `modal` returns the row with `show_modal = false, show_bar = true`.
  7. `daily`: set the dismissal's `closed_at` to yesterday 23:59 Philippine time (as postgres) → the row is back;
     set it to today 00:01 Philippine time → gone.
  8. `every_visit`: `dismiss_announcement` leaves no row and the announcement still returns.
  9. Limits refused: name '' and 101 characters; `modal_close_after 61`; `age_min 17`; `age_min 40, age_max 30`;
     `provinces {Atlantis}`; 21 `field_words`; both parts off; `show_bar` on with `bar_html` ''; the 21st
     announcement that is on and not ended.
  10. `admin_announcements()` for a1: `status` is `live` / `scheduled` / `ended` / `off` for the four cases;
      `matched` counts t1, t2, e1, a1, a2 for an empty filter (not b1); `closed_modal` is 1 after t1's dismiss.
  11. `announcement_audience('{"genders": ["female"]}')` = number of female non-banned accounts in the test.
  12. `used_photo_srcs()` contains `https://<PHOTO_URL_PREFIX host>/abc.webp` after a1 saves `modal_html`
      `<p><img src="…/abc.webp"></p>` (use the prefix value from `src/lib/constants.ts`).
  13. `admin_actions` has `announcement_saved` and `announcement_deleted` rows for a1.

- [ ] **Step 2: Run it to see it fail**

  Run: `npx -y supabase@latest db reset` then
  `docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcements.sql`
  Expected: ERROR, `function public.save_announcement(jsonb) does not exist`.

- [ ] **Step 3: Write the migration**

  Header comment like the other migrations (what, why, spec path, test path). Sections:
  1. Tables + checks. Word lists checked with a small immutable helper
     `announcement_words_ok(words text[]) returns boolean` (≤ 20, each 1–60 characters).
  2. `announcement_is_live`: `is_on and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at
     > now())`.
  3. `announcement_matches`: reads `user_settings` for `uid`; false when `uid` is in `banned_users`; each filter
     passes when its list is empty / its number is null; otherwise the detail must be present and match. Ages by
     `age_on(birth_date, manila_today())`; words by `position(lower(w) in lower(town)) > 0` for any word;
     presentations by `count(*) from presentations where owner_id = uid and shared_from is null`; roles:
     `editor` = row in `editors`, `admin` = row in `admins`, `teacher` = neither.
  4. `save_announcement`: super admin check (`42501`, words "Only the super admin can do this."),
     `jsonb_populate_record(null::public.announcements, a)` for the values, insert or update by id
     (`updated_at = now()`), the 20-limit check (errcode `22023`, "At most 20 announcements can be on at once."),
     `log_admin_action('announcement_saved', 'announcement', id::text, name, null)`.
     `set_announcement_on` and `delete_announcement` the same way (`delete` logs `announcement_deleted`).
  5. `admin_announcements`, `announcement_audience` (`jsonb_populate_record` again, then
     `count(*) from user_settings s where announcement_matches(r, s.user_id)`), `my_announcements` (live, matches
     `auth.uid()`, a part is returned as off when closed: `once` = a dismissal exists, `daily` =
     `(closed_at at time zone 'Asia/Manila')::date = manila_today()`; rows with both parts off are left out),
     `dismiss_announcement` (upsert `closed_at = now()`; nothing for `every_visit` or an unknown id).
  6. `create or replace function public.maintenance_status()` = the current body plus `'announcements_key',
     (select md5(string_agg(a.id::text || a.updated_at::text, ',' order by a.id)) from public.announcements a
     where public.announcement_is_live(a))`.
  7. `create or replace function public.used_photo_srcs()` = the body from `20261214000000_profile_photos.sql`
     plus `union select (regexp_matches(a.modal_html, '<img[^>]+src="([^"]+)"', 'g'))[1] from
     public.announcements a`.
  8. `admin_actions` checks: the list from `20261219000000_maintenance.sql` plus `announcement_saved`,
     `announcement_deleted`; target types plus `announcement`.
  9. Grants: client functions `revoke … from public, anon; grant … to authenticated`;
     `announcement_matches` and `announcement_words_ok` revoked from `public, anon, authenticated`.

- [ ] **Step 4: Run the test to see it pass**

  Same commands as Step 2. Expected: ends with `ROLLBACK`, no `FAIL`, no `ERROR`. Also run
  `supabase/tests/maintenance.sql` again (expected the same), since `maintenance_status` changed.

- [ ] **Step 5: Notes + commit**

  Add the migration and what it does to `supabase/migrations/CLAUDE.md`.
  `git add supabase/ && git commit -m "Database for announcements"`

---

### Task 2: `src/lib/announcements.ts` (page groups, zod, what shows) + maintenance key

**Files:**
- Create: `src/lib/announcements.ts`, `src/lib/announcements.test.ts`
- Modify: `src/lib/maintenance.ts` (+ add `announcementsKey`), `src/lib/adminActions.ts`, `src/lib/CLAUDE.md`

**Interfaces:**
- Consumes: Task 1's function names and column names.
- Produces:
  - `PAGE_GROUPS: readonly { key: PageGroup; label: string }[]` (the spec's 11 groups, in its order);
    `type PageGroup`; `pageGroup(pathname: string): PageGroup | null`
  - `REPEATS = ["once", "daily", "every_visit"] as const`, `REPEAT_LABELS`; `ANNOUNCEMENT_ROLES = ["teacher",
    "editor", "admin"] as const`, `ROLE_LABELS`; `type AnnouncementPart = "modal" | "bar"`
  - `ANNOUNCEMENT_LIMITS = { name: 100, modalHtml: 20_000, barHtml: 1_000, closeAfter: 60, ageMin: 18, ageMax:
    100, presentationsMax: 50, words: 20, wordLength: 60 }`
  - `announcementSchema` (zod object, keys = the SQL column names, `id: z.uuid().nullable()`; refines: a part is
    on, an on part has text, min ≤ max, `ends_at` after `starts_at`), `type AnnouncementInput`
  - `myAnnouncementSchema` (one `my_announcements` row), `type MyAnnouncement`
  - `pickForPage(list: MyAnnouncement[], group: PageGroup, closed: ReadonlySet<string>): { modals:
    MyAnnouncement[]; bars: MyAnnouncement[] }`: fits `pages` (`all` or the group), skips closed parts (key
    `` `${id}:${part}` ``), newest `created_at` first, at most 2 bars
  - `manilaDay(now: Date): string` (YYYY-MM-DD in Philippine time)
  - `MaintenanceStatus.announcementsKey: string | null`

- [ ] **Step 1: Write the failing tests in `src/lib/announcements.test.ts`**

  - `pageGroup`: `/` and `/presentations` → `my_presentations`; `/teachers` → `other_teachers`;
    `/teachers/ria-santos` → `teacher_profiles`; `/presentation/abc` → `presentation_view`;
    `/presentation/abc/edit` and `/presentation/new` → `editor`; `/account` → `account`;
    `/admin`, `/login`, `/privacy`, `/maintenance`, `/presentation/abc/edit/x` → `null`.
  - `announcementSchema`: a valid input parses; refused: `name` "" and 101 characters, `modal_close_after` 61,
    `age_min` 17, `age_min 40, age_max 30`, 21 `field_words`, a 61-character word, both parts off, `show_bar`
    with `bar_html` "", `ends_at` before `starts_at`, `pages` [].
  - `pickForPage`: `{all}` shows on `saved`; `{editor}` doesn't show on `saved`; a closed `id:modal` hides the
    modal but not the bar; 3 bars → the 2 newest; modals newest first.
  - `manilaDay(new Date("2026-10-30T16:30:00Z"))` → `"2026-10-31"`; `("2026-10-30T15:59:00Z")` → `"2026-10-30"`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npm test`. Expected: FAIL, `Cannot find module './announcements'`.

- [ ] **Step 3: Write `src/lib/announcements.ts`**

  Reuse `is_province`'s list from `src/lib/provinces.ts` and `EDUCATION_LEVELS` from `src/lib/userSettings.ts`
  in the zod schema. Header comment pointing to the spec and the migration.

- [ ] **Step 4: Run the tests to see them pass**

  Run: `npm test`. Expected: all pass.

- [ ] **Step 5: Maintenance key + admin log words**

  `src/lib/maintenance.ts`: `statusSchema` gets `announcements_key: z.string().nullable().catch(null)`; the status
  gets `announcementsKey`; `OFF` has `null`. `src/lib/adminActions.ts`: `announcement_saved: "Saved an
  announcement"`, `announcement_deleted: "Deleted an announcement"`. Check `src/app/admin/activity` shows the new
  target type (add `announcement` wherever target types are listed). Run `npx tsc --noEmit`: no errors.

- [ ] **Step 6: Notes + commit**

  `src/lib/CLAUDE.md`: `announcements.ts` line; `maintenance.ts` line says it also carries the announcements key.
  Commit: `git commit -m "Announcements: page groups, limits and what shows"`

---

### Task 3: Packages + safe announcement text

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/lib/announcementText.ts`, `src/lib/announcementText.test.ts`

**Interfaces:**
- Produces:
  - `ANNOUNCEMENT_MODAL_EXTENSIONS` (`TEXT_EXTENSIONS` from `richText.ts` + `Link.configure({ openOnClick: false,
    autolink: false })` + `Image.configure({ inline: false, allowBase64: false })`), `ANNOUNCEMENT_BAR_EXTENSIONS`
    (no Image)
  - `cleanAnnouncementDoc(doc: JSONContent): JSONContent`: drops `image` nodes whose `src` doesn't start with
    `PHOTO_URL_PREFIX`, and `link` marks whose `href` isn't `https://…`, `http://…` or a path starting with `/`
    (not `//`)
  - `toSafeAnnouncementHtml(html: string, part: AnnouncementPart): string` = `generateHTML(cleanAnnouncementDoc(
    generateJSON(html, ext)), ext)`; browser only
  - `isInternalLink(href: string): boolean` (starts with `/` but not `//`)

- [ ] **Step 1: Install**

  Run: `npx -y npm@10.9.2 install @tiptap/extension-link@^3.31.3 @tiptap/extension-image@^3.31.3`.
  Expected: both in `dependencies`, lock file changed, no other package changed.

- [ ] **Step 2: Write the failing test `src/lib/announcementText.test.ts`**

  On `cleanAnnouncementDoc` (pure, no DOM): an image from `PHOTO_URL_PREFIX` stays; `https://evil.example/x.png`
  is dropped; `javascript:alert(1)`, `JAVASCRIPT:alert(1)`, `//evil.example` and `data:text/html,…` link marks are
  dropped and their text stays; `https://deped.gov.ph` and `/saved` stay. `isInternalLink("/saved")` true,
  `("//x.com")` false, `("https://x.com")` false.

- [ ] **Step 3: Run it to see it fail** — `npm test`, expected FAIL (module not found).

- [ ] **Step 4: Write `src/lib/announcementText.ts`** — `generateJSON` already drops `<script>` and `on…=`
  attributes, since the extensions don't allow them; `cleanAnnouncementDoc` covers what the extensions do allow.

- [ ] **Step 5: Run it to see it pass** — `npm test`, all pass.

- [ ] **Step 6: Notes + commit**

  `src/lib/CLAUDE.md`: `announcementText.ts` line. `git add package.json package-lock.json src/lib && git commit -m
  "Safe announcement text (links and images)"`

---

### Task 4: Picture upload route

**Files:**
- Create: `src/app/api/announcement-image/route.ts`
- Modify: `src/lib/photos.tsx` (export a client helper), `src/app/api/CLAUDE.md`

**Interfaces:**
- Consumes: `readPhotoType`, `photoFileName`, `savePhotoFile` (`src/lib/photoFiles.ts`); `PHOTO_URL_PREFIX`;
  `MAX_STORED_PHOTO_BYTES`; the `count_write` rpc.
- Produces: `POST /api/announcement-image?width=&height=` → `{ src: string }`; in `src/lib/photos.tsx`
  `uploadAnnouncementPhoto(file: Blob): Promise<string>` (shrinks with `shrinkPhoto`, posts, returns `src`, throws
  `PhotoError` with the route's words).

- [ ] **Step 1: Write the route**, modeled on `upload-image`: 401 when logged out; 403 "Only the super admin can
  do this." unless `is_super_admin`; size and type checks like `upload-image` (WebP or JPEG); `count_write({ kind:
  "photos" })` (429 "You're adding photos too fast. Wait a minute and try again."); `savePhotoFile`; returns
  `{ src }`. Adds no row anywhere. The proxy already returns 503 during maintenance for `/api/*`.
- [ ] **Step 2: Write `uploadAnnouncementPhoto`** next to `uploadPhoto`.
- [ ] **Step 3: Check** — `npx tsc --noEmit` and `npm run lint`: no errors in these files.
- [ ] **Step 4: Notes + commit** — a row for the route in `src/app/api/CLAUDE.md`'s table (super admin, R2 only,
  kept by the photo cleanup because `used_photo_srcs` reads `modal_html`; an image uploaded but never saved is
  deleted by the weekly cleanup after 7 days). `git commit -m "Upload route for announcement pictures"`

---

### Task 5: Admin → Announcements (list, form, editor, preview)

**Files:**
- Create in `src/app/admin/announcements/`: `page.tsx` (list), `loading.tsx`, `actions.ts`,
  `AnnouncementList.tsx`, `AnnouncementForm.tsx`, `AnnouncementTextEditor.tsx`, `new/page.tsx`,
  `[id]/page.tsx`
- Modify: `src/app/admin/AdminMenu.tsx`, `src/components/Modal.tsx`, `src/app/admin/CLAUDE.md`,
  `src/components/CLAUDE.md`
- Create: `src/components/AnnouncementView.tsx` (shared with Task 6)

**Interfaces:**
- Consumes: Task 1's rpcs; Task 2's `announcementSchema`, `PAGE_GROUPS`, labels, limits; Task 3's extensions and
  `toSafeAnnouncementHtml`, `isInternalLink`; Task 4's `uploadAnnouncementPhoto`; `forgetMaintenanceStatus`.
- Produces:
  - `Modal` gets `canClose?: boolean` (default `true`): when false, no X (its place shows nothing), and Esc and a
    click outside do nothing.
  - `AnnouncementView.tsx` (client): `AnnouncementModal({ html, closeAfter, onClose }: { html: string;
    closeAfter: number; onClose: () => void })` (the `Modal` with title "Announcement", the safe HTML, and a
    footer that counts down "You can close this in N…", then `canClose`); `AnnouncementBar({ html, closeAfter,
    onClose, isFloating })` (a `bg-accent-soft` strip with ink text and `MegaphoneIcon`, X after the countdown;
    `isFloating` = the floating card at the bottom like `MaintenanceNotice`). Links: `isInternalLink` → `<Link>`,
    others `target="_blank" rel="noopener noreferrer"` (done by setting `target`/`rel` on `<a>` after rendering,
    or with a click handler on the container that routes internal links with `router.push`). Images:
    `max-w-full h-auto rounded-dropdown`.
  - `actions.ts` (`"use server"`): `saveAnnouncement(input: AnnouncementInput): Promise<{ error: string } | { id:
    string }>`, `setAnnouncementOn(id: string, turnOn: boolean): Promise<string | null>`,
    `deleteAnnouncement(id: string): Promise<string | null>`, `countAudience(input: AnnouncementInput):
    Promise<number | null>`. Each: zod first, `getAccount().isSuperAdmin`, rpc, on success
    `forgetMaintenanceStatus()` and `refresh()` (like `src/app/admin/maintenance/actions.ts`). Refusal `22023` →
    the database's words; others → "Couldn't save the announcement. Please try again."

- [ ] **Step 1: Modal `canClose`** — add the prop; existing callers unchanged.
- [ ] **Step 2: `AnnouncementView.tsx`** — both parts, built on `toSafeAnnouncementHtml` (computed in an effect,
  since it needs the DOM).
- [ ] **Step 3: `actions.ts`.**
- [ ] **Step 4: List page** — server page: `notFound()` unless the super admin (like the other `superOnly`
  pages), reads `admin_announcements()`. `AnnouncementList`: name, status pill (Live = `bg-success-soft
  text-success-strong`, Scheduled = `bg-highlight-soft text-text-primary`, Ended / Off = `bg-bg-page
  text-text-secondary`), parts, "Matches N", "Closed: modal N · bar N", buttons Edit (`Link` + `LinkPending`),
  Turn on/off, Delete (`ConfirmModal`, danger). Empty state: "No announcements yet." + "New announcement" main
  button.
- [ ] **Step 5: `AnnouncementTextEditor.tsx`** — `useEditor` with the modal or bar extensions; toolbar of
  `rounded-dropdown` buttons: Bold, Italic, Underline (`BoldIcon`, `ItalicIcon`, `UnderlineIcon`), color
  (`<input type="color">`), align left/center/right (`AlignLeftIcon` …), link (`LinkIcon`: asks for the address
  in a small `Modal`, refuses what `isInternalLink` / `https?://` doesn't allow), image (`ImageIcon`, modal only:
  file input → `uploadAnnouncementPhoto` with the `Spinner` on the button, then `setImage({ src })`; errors as a
  toast). `onChange(html)` with `editor.getHTML()`; "" when `editor.isEmpty`.
- [ ] **Step 6: `AnnouncementForm.tsx`** — sections in the spec's order (1–9). Times: `<input
  type="datetime-local">` read as Philippine time (`value + ":00+08:00"`), shown back the same way. Provinces: a
  checkbox list with a filter box. Word lists: one text input, comma separated, split and trimmed. "Matches about
  N teachers now": `countAudience` 500 ms after the last change, `Spinner` while asking. Preview: shows
  `AnnouncementModal` and `AnnouncementBar` with the current HTML and delays. Save: `btn-press` main button with
  the `Spinner` while saving; errors as a sonner toast; on success go to the list.
- [ ] **Step 7: `new/page.tsx`, `[id]/page.tsx`** (`notFound()` for a plain admin or a missing id), `loading.tsx`
  with the top line and the Spinner, and `{ href: "/admin/announcements", label: "Announcements", superOnly: true
  }` in `AdminMenu` next to Maintenance.
- [ ] **Step 8: Check** — `npx tsc --noEmit`, `npm run lint`: no errors. `npm run dev`, as the super admin
  locally: make, edit, preview, turn off, delete an announcement; a plain admin gets "page not found".
- [ ] **Step 9: Notes + commit** — `src/app/admin/CLAUDE.md` (the page), `src/components/CLAUDE.md` (`Modal`'s
  `canClose`, `AnnouncementView`). `git commit -m "Admin → Announcements"`

---

### Task 6: What teachers see + Privacy Policy

**Files:**
- Create: `src/components/Announcements.tsx` (server), `src/components/AnnouncementsWatch.tsx` (client)
- Modify: `src/app/layout.tsx`, `src/app/(legal)/privacy/page.tsx`, `src/lib/legal.ts`, root `CLAUDE.md`,
  `src/components/CLAUDE.md`

**Interfaces:**
- Consumes: `getMaintenanceStatus().announcementsKey`; `pageGroup`, `pickForPage`, `myAnnouncementSchema`,
  `manilaDay` (Task 2); `AnnouncementModal`, `AnnouncementBar` (Task 5); `isEditorPage` (`Footer.tsx`); the
  browser Supabase client (`src/lib/supabase/`).
- Produces: `Announcements()` (async server component: `null` when the key is null, else `<AnnouncementsWatch
  announcementsKey={key} />`), placed in the root layout right after `<MaintenanceBar />`.

- [ ] **Step 1: `AnnouncementsWatch`** —
  - sessionStorage `qm:announcements` = `{ key, day, items, closed: string[] }`, every read and write in
    try/catch;
  - on mount and pathname change: no fetch when `pageGroup(pathname)` is null; fetch `my_announcements` (parse
    with `myAnnouncementSchema`; on error show nothing) only when the stored `key` or `day` (`manilaDay(new
    Date())`) differs;
  - render `pickForPage(...)`: bars in the flow (or floating on `isEditorPage`), the first modal only;
  - hidden while `document.fullscreenElement` (listen to `fullscreenchange`);
  - closing: add `id:part` to `closed` and save; for `once` / `daily` also call `dismiss_announcement` (no message
    on failure).
- [ ] **Step 2: `Announcements` + layout** — the server component and one line in `layout.tsx` with a comment like
  its neighbours.
- [ ] **Step 3: Privacy Policy** — in `src/app/(legal)/privacy/page.tsx`, where it lists how details are used, add
  the two points from the spec's "Privacy Policy" section; set `LEGAL_VERSION` to the day of this commit.
- [ ] **Step 4: Manual checks** (local, `npm run dev`, Docker database), each with its expected result:
  1. No live announcement → the dev request counter shows no `my_announcements` call on any page.
  2. A `{saved}` modal + bar for women: a female teacher sees both on `/saved` only; a male teacher sees neither.
  3. Close delay 5: no X for 5 seconds; Esc and a click outside do nothing until then.
  4. `once`: closed → gone after a reload and after logging in again.
  5. `daily`: closed → gone; after changing `closed_at` to yesterday in the local database and opening a new tab →
     back.
  6. `every_visit`: closed → gone on other pages; back in a new tab.
  7. The editor page: the bar floats at the bottom and the editor's layout is unchanged.
  8. Present a presentation fullscreen → nothing shows; leave fullscreen → the modal shows.
  9. A new announcement shows within about a minute after a full reload; the admin sees theirs at once.
- [ ] **Step 5: Check** — `npx tsc --noEmit`, `npm run lint`, `npm test`: no errors.
- [ ] **Step 6: Notes + commit** — root `CLAUDE.md`: a map line (`src/app/admin/announcements/`) and an
  "Announcements" section with the rules (super admin only; rules in the database functions; the key rides on
  `maintenance_status`; `once` / `daily` / `every_visit`; empty details don't match; hidden while fullscreen;
  safe text; the migration and the test). The "Maintenance" section says `maintenance_status()` also carries
  `announcements_key`. `src/components/CLAUDE.md`: `Announcements` / `AnnouncementsWatch`.
  `git commit -m "Teachers see announcements; Privacy Policy"`

---

### Task 7: Final check

- [ ] **Step 1:** `npx -y supabase@latest db reset`, then run `supabase/tests/announcements.sql` and
  `supabase/tests/maintenance.sql`: both end with `ROLLBACK`, no `FAIL` / `ERROR`.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint`, `npm test`: no errors.
- [ ] **Step 3:** `git diff main...HEAD` read next to the spec: every spec section done, nothing extra, the rules
  in `CLAUDE.md` followed (zod before saving, the one Spinner and Modal, the design system, npm 10, notes true,
  Privacy Policy). Report what passed and what failed.
