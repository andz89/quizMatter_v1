# Profile Links by Display Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Profile links use the teacher's display name (`/teachers/teacher-ria`) instead of their account id, and display names become unique.

**Architecture:** The database owns the link name: a `profile_slug(name)` function feeds a generated `user_settings.profile_slug` column with a unique index. `teacher_profile` looks up by link name, `visible_profiles` hands out id → link name, and the sign-up hook refuses a taken name. The app only reads link names; zod checks a name has a letter or number before saving.

**Tech Stack:** Next.js (App Router, this repo's version), Supabase Postgres (SQL migrations), zod 4, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-10-profile-name-links-design.md`

## Global Constraints

- The link comes from `user_settings.display_name` only; first and last name are never used.
- Link form rule (database only): `normalize(name, NFD)` → `lower` → `regexp_replace('[^a-z0-9]+', '-', 'g')` → `trim(both '-')`.
- Taken message, word for word in SQL and TS: `That display name is taken. Please pick another one.`
- zod message for a name with no letter/number: `Use at least one letter or number (a–z, 0–9) in your display name.`
- Account hint when there's no link: `Add a display name to get a profile link.`
- Validate with zod right before every save (CLAUDE.md "Saving Data").
- Design system classes only; Lucide icons; the one Spinner / TopLoadingBar (already in `loading.tsx`).
- No new packages.
- Plain, simple English in comments.
- Leave browser testing to the user.

## Review Focus

1. **Teacher clears their display name**: save `''` works (the unique index skips `''`), links to them disappear, and the Account page shows the hint. Covered in Task 2 (zod allows `''`) and Task 3 (hint).
2. **Teacher changes only the case or accents of their own name** ("Teacher Ria" → "teacher ría"): same link name on the same row, so no "taken" error. Covered by the unique index being on the row itself (Task 1); noted in Task 1's SQL checks.
3. **Name with no a–z/0–9** ("王老师", "★★★"): refused with the zod message, both on sign up and Account, and also by the database check. Covered in Task 1 (check constraint) and Task 2 (zod + Account pre-check).
4. **Old id link or a link typed in capitals** (`/teachers/3f9a…`, `/teachers/Teacher-Ria`): the id finds nothing → 404; capitals are lowercased first and work. Covered in Task 3 (`loadTeacherProfile`).
5. **A teacher picks an admin's display name**: refused as taken (admins are in `user_settings` too); the admin's profile stays hidden. Covered in Task 1 (index covers every row).

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261112000000_profile_name_links.sql`

**Interfaces:**
- Produces (SQL, used by Tasks 2–3):
  - column `public.user_settings.profile_slug text` (generated, `''` when no link)
  - `public.teacher_profile(slug text) returns table (display_name, first_name, last_name, education_level, education_field, bio text)` — `authenticated` only
  - `public.visible_profiles(profile_ids uuid[]) returns table (id uuid, slug text)` — `authenticated` only
  - sign-up hook error message `That display name is taken. Please pick another one.`
  - unique violation code `23505` on saving a taken name

- [ ] **Step 1: Write the migration**

```sql
-- Profile links by display name (docs/superpowers/specs/2026-10-10-profile-name-links-design.md): a teacher's profile
-- link is /teachers/<link name>, made from their display name only (never the first or last name), e.g.
-- "Teacher Ría!" → teacher-ria. Display names are unique: two names that make the same link count as the same name.
-- Renaming changes the link; the old one shows "not found". The app checks the name with zod first
-- (displayNameSchema in src/lib/userSettings.ts).

-- The one rule for turning a display name into its link name: split accented letters (á → a + accent mark), lower
-- case, every run of anything that isn't a–z or 0–9 becomes one "-", and no "-" at either end. "" = no link.
-- The column below stores its result, so if this rule ever changes, the stored links must be rebuilt too.
create function public.profile_slug(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(normalize(coalesce(name, ''), NFD)), '[^a-z0-9]+', '-', 'g'));
$$;

alter table public.user_settings
  add column profile_slug text generated always as (public.profile_slug(display_name)) stored,
  -- A name must be empty or have a letter or number (zod checks the same thing first).
  add constraint user_settings_display_name_has_link check (display_name = '' or public.profile_slug(display_name) <> '');

-- No two accounts with the same link name. Empty names (no link) are left out. If two names already clash, this
-- stops the migration: rename one by hand and run it again.
create unique index user_settings_profile_slug on public.user_settings (profile_slug) where profile_slug <> '';

-- The public part of a teacher's settings, for their profile page, found by link name. Same fields and same
-- visibility rule (profile_is_visible: admins hidden from teachers) as before; never the contact number or email.
drop function public.teacher_profile(uuid);
create function public.teacher_profile(slug text)
returns table (
  display_name text,
  first_name text,
  last_name text,
  education_level text,
  education_field text,
  bio text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.display_name,
    coalesce(s.first_name, ''),
    coalesce(s.last_name, ''),
    coalesce(s.education_level, ''),
    coalesce(s.education_field, ''),
    coalesce(s.bio, '')
  from public.user_settings s
  where teacher_profile.slug <> ''
    and s.profile_slug = teacher_profile.slug
    and public.profile_is_visible(s.user_id);
$$;

revoke execute on function public.teacher_profile(text) from anon, public;
grant execute on function public.teacher_profile(text) to authenticated;

-- Which of these accounts have a profile the caller may open, with its link name: the presentation page links only
-- those names. An account with no display name has no link.
drop function public.visible_profiles(uuid[]);
create function public.visible_profiles(profile_ids uuid[])
returns table (id uuid, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.profile_slug
  from public.user_settings s
  where s.user_id = any (profile_ids)
    and s.profile_slug <> ''
    and public.profile_is_visible(s.user_id);
$$;

revoke execute on function public.visible_profiles(uuid[]) from anon, public;
grant execute on function public.visible_profiles(uuid[]) to authenticated;

-- Whether an account already uses a name with this link name. Only the sign-up hook below calls it.
create function public.display_name_taken(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.profile_slug(name) <> ''
    and exists (select 1 from public.user_settings s where s.profile_slug = public.profile_slug(name));
$$;

revoke execute on function public.display_name_taken(text) from anon, authenticated, public;
grant execute on function public.display_name_taken(text) to supabase_auth_admin;

-- The sign-up hook (20261108000000_sign_up_limit.sql), now also refusing a taken display name. That check comes
-- first, so a taken name doesn't use up one of the 10 sign ups per internet address. Keep the message the same as
-- DISPLAY_NAME_TAKEN_MESSAGE in src/lib/userSettings.ts.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  client_ip inet;
begin
  if public.display_name_taken(event -> 'user' -> 'user_metadata' ->> 'display_name') then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'That display name is taken. Please pick another one.'
    ));
  end if;

  -- No address, or one Postgres can't read (shouldn't happen): allow, rather than block everyone.
  begin
    client_ip := nullif(event -> 'metadata' ->> 'ip_address', '')::inet;
  exception when others then
    client_ip := null;
  end;
  if client_ip is null then
    return '{}'::jsonb;
  end if;

  if (
    select count(*) from public.sign_up_attempts a
    where a.ip = client_ip and a.created_at > now() - interval '1 hour'
  ) >= 10 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'Too many accounts were made from this internet connection. Please try again in an hour.'
    ));
  end if;

  insert into public.sign_up_attempts (ip) values (client_ip);
  return '{}'::jsonb;
end;
$$;
```

Notes for the implementer:
- `create or replace` keeps the existing grants on `hook_before_user_created`; don't re-grant.
- The hook runs as `supabase_auth_admin`, which can't read `user_settings`; that's why `display_name_taken` is `security definer` and granted to it.
- Renaming your own row to the same link name ("Teacher Ria" → "teacher ría") doesn't break the unique index, because it's the same row.

- [ ] **Step 2: Re-read it against the spec**

Check: function names and signatures match the Interfaces block; the message text matches Global Constraints word for word; the old `hook_before_user_created` body is unchanged apart from the new first `if`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261112000000_profile_name_links.sql
git commit -m "Profile links by display name: database"
```

The user applies the migration. Quick checks they can run in the SQL editor afterwards:
`select public.profile_slug('Teacher Ría!');` → `teacher-ria`; `select public.profile_slug('★★★');` → `''`.

---

### Task 2: Display name rules in the app (zod, Account save, sign up)

**Files:**
- Modify: `src/lib/userSettings.ts` (`displayNameSchema`, new `DISPLAY_NAME_TAKEN_MESSAGE`, `saveDisplayName`)
- Modify: `src/app/account/AccountForms.tsx` (`ProfileForm.save`)
- Modify: `src/app/signup/page.tsx` (`signUpErrorMessage`, import)

**Interfaces:**
- Consumes: unique violation `23505` and the hook message from Task 1.
- Produces: `export const DISPLAY_NAME_TAKEN_MESSAGE: string` in `src/lib/userSettings.ts`; `displayNameSchema` now refuses a non-empty name without a–z/0–9.

- [ ] **Step 1: zod rule and taken message — `src/lib/userSettings.ts`**

Replace:

```ts
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const displayNameSchema = z.string().trim().max(DISPLAY_NAME_MAX_LENGTH);
```

with:

```ts
export const DISPLAY_NAME_MAX_LENGTH = 80;
// The display name also makes the profile link (/teachers/teacher-ria), so it needs a letter or number a–z / 0–9
// once accents are taken off (the database's profile_slug rule: "Ría" → "ria", "★★★" → no link). Empty = no link.
export const displayNameSchema = z
  .string()
  .trim()
  .max(DISPLAY_NAME_MAX_LENGTH)
  .refine(
    (name) => name === "" || /[a-z0-9]/.test(name.normalize("NFD").toLowerCase()),
    "Use at least one letter or number (a–z, 0–9) in your display name.",
  );
// Display names are unique (by link name). Same words as the sign-up hook (20261112000000_profile_name_links.sql).
export const DISPLAY_NAME_TAKEN_MESSAGE = "That display name is taken. Please pick another one.";
```

`signUpSchema` already does `displayNameSchema.min(1, "Enter a display name.")`; in zod 4 `.min` chains after `.refine` on a string, so leave it as is.

- [ ] **Step 2: `saveDisplayName` turns the unique-index error into the taken message**

Replace in `saveDisplayName`:

```ts
  if (error) throw error;
}

/**
 * Makes a new account.
```

with:

```ts
  // 23505: another account's name makes the same link (the user_settings_profile_slug index).
  if (error?.code === "23505") throw new Error(DISPLAY_NAME_TAKEN_MESSAGE);
  if (error) throw error;
}

/**
 * Makes a new account.
```

- [ ] **Step 3: Account form shows the zod message and the taken message — `src/app/account/AccountForms.tsx`**

Add `displayNameSchema` and `DISPLAY_NAME_TAKEN_MESSAGE` to the existing import from `@/lib/userSettings`. Replace the `save` function in `ProfileForm`:

```tsx
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const checked = displayNameSchema.safeParse(name);
    if (!checked.success) return toast.error(checked.error.issues[0].message);
    setIsSaving(true);
    try {
      await saveDisplayName(name);
      toast.success("Name saved.");
      // Reloads the server parts, so the account menu and the profile link show the new name.
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message === DISPLAY_NAME_TAKEN_MESSAGE
          ? DISPLAY_NAME_TAKEN_MESSAGE
          : "Couldn't save your name. Please try again.",
      );
    }
    setIsSaving(false);
  };
```

(`saveDisplayName` still parses with zod itself right before saving.)

- [ ] **Step 4: Sign up shows the taken message — `src/app/signup/page.tsx`**

Add `DISPLAY_NAME_TAKEN_MESSAGE` to the existing `@/lib/userSettings` import. In `signUpErrorMessage`, right after the `SIGN_UP_ADDRESS_MESSAGE` line, add:

```ts
  // Another account already uses this display name (hook_before_user_created).
  if (error.message.includes(DISPLAY_NAME_TAKEN_MESSAGE)) return DISPLAY_NAME_TAKEN_MESSAGE;
```

The form already checks `signUpSchema` before sending, so the new zod rule shows its message there by itself.

- [ ] **Step 5: Check types and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors in the three changed files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/userSettings.ts src/app/account/AccountForms.tsx src/app/signup/page.tsx
git commit -m "Profile links by display name: unique display names in the app"
```

---

### Task 3: Profile page and links by link name

**Files:**
- Move: `src/app/teachers/[id]/page.tsx` → `src/app/teachers/[slug]/page.tsx`
- Move: `src/app/teachers/[id]/loading.tsx` → `src/app/teachers/[slug]/loading.tsx` (no content change)
- Modify: `src/lib/profiles.ts` (`loadTeacherProfile`, `loadVisibleProfiles`, `profileHref`, top comment)
- Modify: `src/lib/fetchPresentation.ts` (`visibleProfileIds` → `profileSlugs`)
- Modify: `src/app/presentation/[id]/page.tsx` (prop)
- Modify: `src/app/presentation/[id]/PresentationPreview.tsx` (prop, `ProfileName`)
- Modify: `src/lib/account.ts` (`profileSlug`)
- Modify: `src/app/account/page.tsx` (links or hint)

**Interfaces:**
- Consumes: `teacher_profile(slug text)`, `visible_profiles(uuid[]) → (id, slug)`, `user_settings.profile_slug` (Task 1).
- Produces:
  - `loadTeacherProfile(supabase: SupabaseClient, slug: string): Promise<TeacherProfile | null>`
  - `loadVisibleProfiles(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>>` (id → link name)
  - `profileHref(slug: string): string`
  - `fetchPresentation(...)` result field `profileSlugs: Record<string, string>` (replaces `visibleProfileIds`)
  - `Account.profileSlug: string`

- [ ] **Step 1: Move the route folder**

```bash
git mv "src/app/teachers/[id]" "src/app/teachers/[slug]"
```

- [ ] **Step 2: `src/lib/profiles.ts`**

Replace the top comment's first line `// A teacher's profile page (/teachers/<id>): …` with:

```ts
// A teacher's profile page (/teachers/<link name>, e.g. /teachers/teacher-ria, made from the display name by the
// database's profile_slug): the public part of their settings, which any logged-in user can open
// with the link. It comes from the teacher_profile database function (20261112000000_profile_name_links.sql), which
// never hands out the contact number or email, and hides admins from teachers.
```

(remove the old three comment lines it replaces). Replace `loadTeacherProfile` with:

```ts
// A link name: lowercase letters and digits in groups joined by "-" (what profile_slug makes), at most the display
// name's length.
const profileSlugSchema = z.string().max(DISPLAY_NAME_MAX_LENGTH).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** The profile, or null if no teacher has this link (or it's an admin the viewer may not see). Throws if it fails. */
export async function loadTeacherProfile(supabase: SupabaseClient, slug: string): Promise<TeacherProfile | null> {
  // Capitals in a typed link still work; anything else that isn't a link name (e.g. /teachers/a%20b) isn't anyone.
  const checked = profileSlugSchema.safeParse(slug.toLowerCase());
  if (!checked.success) return null;
  const { data, error } = await supabase.rpc("teacher_profile", { slug: checked.data }).maybeSingle<{
```

(the rest of the function body stays the same). Replace `loadVisibleProfiles` and `profileHref` with:

```ts
/**
 * The link names of these accounts' profiles the user may open (everyone's except a hidden admin's, and only if they
 * have a display name), by account id, so a page links only those names. Empty if the lookup fails: names then just
 * aren't links.
 */
export async function loadVisibleProfiles(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc("visible_profiles", { profile_ids: ids });
  if (error) return new Map();
  return new Map((data as { id: string; slug: string }[]).map((row) => [row.id, row.slug]));
}

export function profileHref(slug: string) {
  return `/teachers/${slug}`;
}
```

Add `DISPLAY_NAME_MAX_LENGTH` to the existing import from `./userSettings`.

- [ ] **Step 3: `src/app/teachers/[slug]/page.tsx`**

Change the comment's first sentence and the signature:

```tsx
/**
 * A teacher's profile, at /teachers/<link name> (made from their display name): display name, full name, educational
 * background and bio. Any logged-in user can open it with the link (the proxy sends logged-out people to log in
 * first). Never the contact number or email: see loadTeacherProfile.
 */
export default async function TeacherProfilePage({ params }: PageProps<"/teachers/[slug]">) {
  const { slug } = await params;
  const profile = await loadTeacherProfile(await createClient(), slug);
```

Everything below stays the same.

- [ ] **Step 4: `src/lib/fetchPresentation.ts`**

In the return type, replace:

```ts
  // The owner and reviewers whose profile pages this user may open (not a hidden admin's): only these names are links.
  visibleProfileIds: string[];
```

with:

```ts
  // Profile link names by account id, for the owner and reviewers whose profile this user may open (not a hidden
  // admin's, not someone without a display name): only these names are links.
  profileSlugs: Record<string, string>;
```

In the body, rename `visibleProfiles` to `profileSlugs` in the `Promise.all` destructuring, and in the returned object replace `visibleProfileIds: [...visibleProfiles],` with:

```ts
    profileSlugs: Object.fromEntries(profileSlugs),
```

- [ ] **Step 5: `src/app/presentation/[id]/page.tsx`**

Replace `visibleProfileIds={result.visibleProfileIds}` with `profileSlugs={result.profileSlugs}`.

- [ ] **Step 6: `src/app/presentation/[id]/PresentationPreview.tsx`**

In the props destructuring and type, replace `visibleProfileIds` / `visibleProfileIds: string[];` with `profileSlugs` / `profileSlugs: Record<string, string>;`. In the two `ProfileName` uses, replace `visibleIds={visibleProfileIds}` with `slugs={profileSlugs}`. Replace `ProfileName` with:

```tsx
/** A publisher's or reviewer's name: a link to their profile, or plain text when it has none (a hidden admin's). */
function ProfileName({ id, name, slugs }: { id: string; name: string; slugs: Record<string, string> }) {
  const slug = slugs[id];
  if (!slug) return <span className="font-semibold text-text-primary">{name}</span>;
  return (
    <Link href={profileHref(slug)} className="font-semibold text-accent hover:underline">
      {name}
      <LinkPending />
    </Link>
  );
}
```

- [ ] **Step 7: `src/lib/account.ts`**

Add to the `Account` type after `displayName: string;`:

```ts
  // The profile link name made from the display name ("" when there's none, so no profile link).
  profileSlug: string;
```

Add `profile_slug` to the `user_settings` select (`"display_name, profile_slug, first_name, …"`), and to the returned object after `displayName`:

```ts
    profileSlug: settings?.profile_slug ?? "",
```

- [ ] **Step 8: `src/app/account/page.tsx`**

Replace:

```tsx
          {/* Teachers can't open an admin's profile, so admins get no link to share. */}
          {!account.isAdmin && <ProfileLinks href={profileHref(account.id)} />}
```

with:

```tsx
          {/* Teachers can't open an admin's profile, so admins get no link to share. The link comes from the display name. */}
          {!account.isAdmin &&
            (account.profileSlug ? (
              <ProfileLinks href={profileHref(account.profileSlug)} />
            ) : (
              <p className="mt-3 text-sm text-text-secondary">Add a display name to get a profile link.</p>
            ))}
```

- [ ] **Step 9: Regenerate route types, then check types and lint**

Run: `npx next typegen` (refreshes the `PageProps<"/teachers/[slug]">` route types), then `npx tsc --noEmit` and `npm run lint`.
Expected: no errors. If `next typegen` isn't in this Next version, check `node_modules/next/dist/docs/` for how route types are made.

Then: `git grep -n "visibleProfileIds\|teachers/\[id\]"` → expected: no matches in `src/`.

- [ ] **Step 10: Commit**

```bash
git add -A src/app/teachers src/lib/profiles.ts src/lib/fetchPresentation.ts "src/app/presentation/[id]/page.tsx" "src/app/presentation/[id]/PresentationPreview.tsx" src/lib/account.ts src/app/account/page.tsx
git commit -m "Profile links by display name: /teachers/<link name>"
```

---

### Task 4: Final check (CLAUDE.md checking step)

- [ ] **Step 1:** `npx tsc --noEmit` and `npm run lint` — fix any errors in changed files.
- [ ] **Step 2:** `git diff 0eb3821..HEAD` next to the spec: every spec item done, nothing extra; zod before every save; no new packages; design-system classes only.
- [ ] **Step 3:** Tell the user what was checked and what passed, that the migration needs applying, and the browser tests to run (from the spec's "Checks").
