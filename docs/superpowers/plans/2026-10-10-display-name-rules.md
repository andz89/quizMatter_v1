# Display Name Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign up makes the display name from first + last name (random 8-character letter+digit ending when taken); the Account page changes it through a confirm modal, once every 30 days, at most 5 saves in 5 minutes.

**Architecture:** All rules live in the database: `handle_new_user` picks the sign-up name; `set_display_name` is the only way to change it (counts a click first, then returns saved / taken / wait without raising, so the count is kept); a guard trigger refuses any other change by the owner. The app removes the sign-up field, and the Account page opens `ConfirmModal` before calling `set_display_name`.

**Tech Stack:** Next.js (App Router, this repo's version), Supabase Postgres, zod 4, TypeScript, sonner, Lucide.

**Spec:** `docs/superpowers/specs/2026-10-10-display-name-rules-design.md`

## Global Constraints

- Ending: 8 characters from `abcdefghijkmnpqrstuvwxyz23456789`, at least one letter and one digit; up to 20 tries.
- Name with no a–z/0–9 (or no first/last name) → base `Teacher` + ending.
- 30 days between Account-page changes (`DISPLAY_NAME_CHANGE_DAYS = 30`); `display_name_changed_at` null = first change free; admins skip.
- Click limit row: `('display_name', 'Display name', 5, 300, 5, 5, 24, null)`; `pausedText: "Changing your display name"`.
- Modal: title `Is this display name final?`; message `If "<name>" is available, it will be your display name, and you'll have to wait 30 days to change it.`; confirm label `Continue`.
- Sign-up line: `This is your display name. You can change it once later on the Account page.`
- Account hint: `Your profile link is made from it. You can change it once every 30 days.`; while waiting: `You can change your display name again on <date>.`
- zod before every save; reuse `ConfirmModal`, `Spinner`, click-limit system; no new packages; design-system classes only.
- No unit test runner in this repo: each task's gate is `npx tsc --noEmit` + eslint on changed files; the user tests in the browser and applies the migration.

## Review Focus

1. **Same name typed with only case changes** ("teacher ria" for "Teacher Ria"): a real change (counts, starts 30 days), never "taken" by yourself — `claim_display_name` excludes `me` (Task 1).
2. **Saving the unchanged name**: returns `saved`, no wait starts; the Save button is disabled anyway when unchanged (Tasks 1, 3).
3. **Direct table write by a script** (`update user_settings set display_name = …`): refused by the guard; `saveProfile` / favorites upserts (which never send `display_name`) still work (Task 1).
4. **Pause reached on the 5th save**: the 5th save still goes through or returns its status; the 6th is refused with QMBLK and the notice shows (Tasks 1, 3).
5. **Date shown the same on server and browser**: the wait date is formatted in one fixed time zone (Asia/Manila) so the page doesn't flicker (Task 3).

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261113000000_display_name_rules.sql`

**Interfaces:**
- Produces: `user_settings.display_name_changed_at timestamptz`; `public.set_display_name(name text) returns jsonb` → `{"status":"saved"} | {"status":"taken"} | {"status":"wait","until":<unix ms>}`, raises `QMBLK` when paused; click feature `display_name`.

- [ ] **Step 1: Write the migration**

```sql
-- Display name rules (docs/superpowers/specs/2026-10-10-display-name-rules-design.md):
-- - Sign up no longer asks for a display name: handle_new_user makes it from the first + last name, adding 8 random
--   letters and digits when that name is taken ("Maria Santos k3f9p2xa").
-- - On the Account page, set_display_name is the only way to change it: at most once every 30 days (the first change
--   after sign up is free; admins skip this), and at most 5 tries in 5 minutes (the click limit "display_name").
--   The app checks the name with zod first (displayNameSchema in src/lib/userSettings.ts).

alter table public.user_settings add column display_name_changed_at timestamptz;

-- ─── 1. The sign-up hook goes back to the version in 20261108000000_sign_up_limit.sql ──────────────────────────
-- (the person no longer types a display name, so there's nothing to check)
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  client_ip inet;
begin
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

drop function public.display_name_taken(text);

-- ─── 2. Is this link name free for me? ─────────────────────────────────────────────────────────────────────────
-- An account whose email was never confirmed doesn't hold a name: its name is cleared first (so a retry after a
-- mistyped email works, and throwaway sign ups can't hold names). My own row never counts against me.
create function public.claim_display_name(slug text, me uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if slug = '' then
    return false;
  end if;

  update public.user_settings s
  set display_name = '', updated_at = now()
  from auth.users u
  where u.id = s.user_id
    and s.profile_slug = claim_display_name.slug
    and s.user_id <> me
    and u.email_confirmed_at is null;

  return not exists (
    select 1 from public.user_settings s where s.profile_slug = claim_display_name.slug and s.user_id <> me
  );
end;
$$;

revoke execute on function public.claim_display_name(text, uuid) from public, anon, authenticated;

-- 8 random letters and digits, always at least one of each (no look-alikes: no l, o, 0, 1).
create function public.random_name_ending()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  chars constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  ending text;
begin
  loop
    ending := '';
    for i in 1..8 loop
      ending := ending || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    if ending ~ '[a-z]' and ending ~ '[0-9]' then
      return ending;
    end if;
  end loop;
end;
$$;

revoke execute on function public.random_name_ending() from public, anon, authenticated;

-- ─── 3. Sign up: the display name is the first + last name ─────────────────────────────────────────────────────
-- Same as 20261104000000_teacher_sign_up.sql, but the display name isn't read from the sign-up details. It's the
-- first + last name; when that's taken (or makes no link, e.g. "王 老师", or a teacher added by hand with no name),
-- it's that name (or "Teacher") plus 8 random letters and digits. 20 tries: with about a trillion endings a second
-- try practically never happens; if all 20 were taken the insert fails on the unique index and the sign up fails.
-- The longest name (35 + 1 + 35) plus " " and 8 characters is exactly 80, the display name limit.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  given_name text := trim(coalesce(new.raw_user_meta_data ->> 'first_name', ''));
  family_name text := trim(coalesce(new.raw_user_meta_data ->> 'last_name', ''));
  base_name text := trim(given_name || ' ' || family_name);
  new_name text := base_name;
begin
  if public.profile_slug(base_name) = '' then
    base_name := 'Teacher';
    new_name := '';
  end if;

  if not public.claim_display_name(public.profile_slug(new_name), new.id) then
    for attempt in 1..20 loop
      new_name := base_name || ' ' || public.random_name_ending();
      exit when public.claim_display_name(public.profile_slug(new_name), new.id);
    end loop;
  end if;

  insert into public.user_settings
    (user_id, display_name, first_name, last_name, contact_number, education_level, education_field)
  values (
    new.id,
    new_name,
    given_name,
    family_name,
    trim(coalesce(new.raw_user_meta_data ->> 'contact_number', '')),
    coalesce(new.raw_user_meta_data ->> 'education_level', ''),
    trim(coalesce(new.raw_user_meta_data ->> 'education_field', ''))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ─── 4. The click limit: 5 saves in 5 minutes, then paused 5 minutes (never bans) ──────────────────────────────
-- Keep the same as CLICK_FEATURES.display_name in src/lib/clickLimits.ts. Admin → Safety lists it by itself.
insert into public.click_limits
  (feature, label, max_clicks, per_seconds, first_pause_minutes, repeat_pause_minutes, repeat_within_hours, ban_after_pauses)
values
  ('display_name', 'Display name', 5, 300, 5, 5, 24, null);

-- ─── 5. Changing my display name (the Account page's Save name) ────────────────────────────────────────────────
-- Counts the click first (refused with QMBLK while paused). Every answer after that is returned, never raised, so
-- the count is kept even for a taken name. Keep 30 days the same as DISPLAY_NAME_CHANGE_DAYS in userSettings.ts.
create function public.set_display_name(name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_name text := trim(coalesce(name, ''));
  current_name text;
  changed_at timestamptz;
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;

  perform public.count_click('display_name');

  select s.display_name, s.display_name_changed_at into current_name, changed_at
  from public.user_settings s
  where s.user_id = me;

  -- Nothing to change: no wait starts.
  if new_name = coalesce(current_name, '') then
    return jsonb_build_object('status', 'saved');
  end if;

  if not public.is_admin() and changed_at > now() - interval '30 days' then
    return jsonb_build_object(
      'status', 'wait',
      'until', (extract(epoch from changed_at + interval '30 days') * 1000)::bigint
    );
  end if;

  if new_name <> '' and not public.claim_display_name(public.profile_slug(new_name), me) then
    return jsonb_build_object('status', 'taken');
  end if;

  -- Lets the guard below through, for this transaction only.
  perform set_config('qm.set_display_name', 'on', true);
  begin
    insert into public.user_settings as s (user_id, display_name, display_name_changed_at, updated_at)
    values (me, new_name, now(), now())
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      display_name_changed_at = excluded.display_name_changed_at,
      updated_at = excluded.updated_at;
  exception when unique_violation then
    -- Someone took it at the same moment.
    return jsonb_build_object('status', 'taken');
  end;

  return jsonb_build_object('status', 'saved');
end;
$$;

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

-- ─── 6. Guard: a teacher can't change their own display name any other way ─────────────────────────────────────
-- So the 30 days and the click limit can't be skipped by writing user_settings directly. The sign-up trigger and the
-- clearing of unconfirmed accounts' names don't run as the row's owner, so they pass. Saves of other settings
-- (details, favorites) don't send display_name, so they pass too.
create function public.guard_display_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) = new.user_id
    and (case when tg_op = 'INSERT' then new.display_name <> '' else new.display_name is distinct from old.display_name end)
    and coalesce(current_setting('qm.set_display_name', true), '') <> 'on'
  then
    raise exception 'Change your display name on the Account page.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger user_settings_display_name_guard
  before insert or update of display_name on public.user_settings
  for each row execute function public.guard_display_name();
```

- [ ] **Step 2: Re-read against the spec** — hook body identical to `20261108000000_sign_up_limit.sql` (diff it); every function's grants as listed; messages and numbers match Global Constraints.

- [ ] **Step 3: Commit** — `git add supabase/migrations/20261113000000_display_name_rules.sql`, commit "Display name rules: database".

---

### Task 2: App library (settings, click feature, account, date)

**Files:**
- Modify: `src/lib/userSettings.ts`, `src/lib/clickLimits.ts`, `src/lib/account.ts`, `src/lib/format.ts`

**Interfaces:**
- Produces:
  - `DISPLAY_NAME_CHANGE_DAYS = 30`
  - `type DisplayNameResult = { status: "saved" } | { status: "taken" } | { status: "wait"; until: number }`
  - `saveDisplayName(name: string): Promise<DisplayNameResult>` (throws the Supabase error, e.g. QMBLK)
  - `CLICK_FEATURES.display_name`
  - `Account.nextNameChangeAt: number | null`
  - `formatDate(time: number): string` in `src/lib/format.ts` ("Nov 10, 2026", Asia/Manila)
  - `signUpSchema` / `SignUpFields` without `displayName`

- [ ] **Step 1: `src/lib/userSettings.ts`**
  - After `DISPLAY_NAME_TAKEN_MESSAGE`, add:

```ts
// Days between display name changes on the Account page (the first change after sign up is free). Same as
// set_display_name in 20261113000000_display_name_rules.sql.
export const DISPLAY_NAME_CHANGE_DAYS = 30;
```

  - Fix the `DISPLAY_NAME_TAKEN_MESSAGE` comment to: `// Display names are unique (by link name): set_display_name answers "taken".`
  - `signUpSchema`: remove the `displayName: displayNameSchema.min(1, "Enter a display name."),` line, and update its comment: `// Sign up doesn't ask for a bio (added later on the Account page) or a display name (made from the first + last name by handle_new_user, 20261113000000_display_name_rules.sql).`
  - `signUp`: remove `displayName` from the destructuring and `display_name: displayName,` from `data`.
  - Replace `saveDisplayName` with:

```ts
export type DisplayNameResult = { status: "saved" } | { status: "taken" } | { status: "wait"; until: number };

/**
 * Changes the user's display name through set_display_name, which counts it against the click limit and keeps the
 * 30 days between changes. Throws if it fails (e.g. QMBLK while paused: read it with pausedUntilFromError).
 */
export async function saveDisplayName(name: string): Promise<DisplayNameResult> {
  const displayName = displayNameSchema.parse(name);
  const { data, error } = await createClient().rpc("set_display_name", { name: displayName });
  if (error) throw error;
  return data as DisplayNameResult;
}
```

- [ ] **Step 2: `src/lib/clickLimits.ts`** — add to `CLICK_FEATURES` after `create`:

```ts
  display_name: { pausedText: "Changing your display name" },
```

- [ ] **Step 3: `src/lib/format.ts`** — add after `formatDay`:

```ts
/** "Nov 10, 2026" for a time (Unix ms), in the Philippines' time zone, so the server and the browser show the same day. */
export function formatDate(time: number): string {
  return new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}
```

- [ ] **Step 4: `src/lib/account.ts`**
  - Type, after `profileSlug`: `// When the display name can be changed again (Unix ms), or null if it can be changed now (always null for admins).` / `nextNameChangeAt: number | null;`
  - Select: add `display_name_changed_at` after `profile_slug`.
  - Import `DISPLAY_NAME_CHANGE_DAYS` from `./userSettings` (with the existing type import).
  - Before `return`, add:

```ts
  const changedAt = settings?.display_name_changed_at ? Date.parse(settings.display_name_changed_at) : null;
  const nextNameChangeAt = changedAt === null ? null : changedAt + DISPLAY_NAME_CHANGE_DAYS * 24 * 60 * 60 * 1000;
```

  - Return: `nextNameChangeAt: isAdmin !== true && nextNameChangeAt !== null && nextNameChangeAt > Date.now() ? nextNameChangeAt : null,`

- [ ] **Step 5: Verify** — `npx tsc --noEmit`: expected errors only in `src/app/signup/page.tsx` (`displayName`) and `src/app/account/AccountForms.tsx` (result type), fixed in Task 3. Commit together with Task 3 if tsc must be green per commit (Ruling allowed).

---

### Task 3: Pages (sign up, Account)

**Files:**
- Modify: `src/app/signup/page.tsx`, `src/app/account/AccountForms.tsx`, `src/app/account/page.tsx`

- [ ] **Step 1: `src/app/signup/page.tsx`**
  - Remove `displayName: "",` from `emptyFields`, the whole Display name `<Field …>` block, and the `DISPLAY_NAME_MAX_LENGTH` and `DISPLAY_NAME_TAKEN_MESSAGE` imports, and the two lines in `signUpErrorMessage` for `DISPLAY_NAME_TAKEN_MESSAGE` (the hook no longer refuses names).
  - Right after the Last name `</Field>`, add:

```tsx
            <p className="-mt-2 text-xs text-text-secondary sm:col-span-2">
              This is your display name. You can change it once later on the Account page.
            </p>
```

- [ ] **Step 2: `src/app/account/AccountForms.tsx`** — imports: add `ConfirmModal` from `@/components/editor/ConfirmModal`, `pauseFeature, pausedUntilFromError, useIsPaused` from `@/lib/clickLimits`, `formatDate` from `@/lib/format`, `DISPLAY_NAME_CHANGE_DAYS` from `@/lib/userSettings`. Replace `ProfileForm` with:

```tsx
/** Email (read only) and display name. Saving the name asks first: it's then kept for 30 days. */
export function ProfileForm({
  email,
  displayName,
  nextNameChangeAt,
}: {
  email: string;
  displayName: string;
  nextNameChangeAt: number | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isPaused = useIsPaused("display_name");
  const isWaiting = nextNameChangeAt !== null;

  const askToSave = (e: FormEvent) => {
    e.preventDefault();
    const checked = displayNameSchema.safeParse(name);
    if (!checked.success) return toast.error(checked.error.issues[0].message);
    setIsConfirming(true);
  };

  const save = async () => {
    setIsConfirming(false);
    setIsSaving(true);
    try {
      const result = await saveDisplayName(name);
      if (result.status === "saved") {
        toast.success("Name saved.");
        // Reloads the server parts: the account menu, the profile link and the 30-day wait.
        router.refresh();
      } else if (result.status === "taken") {
        toast.error(DISPLAY_NAME_TAKEN_MESSAGE);
      } else {
        toast.error(`You can change your display name again on ${formatDate(result.until)}.`);
      }
    } catch (error) {
      // Paused: the button greys out and the notice at the bottom says until when.
      const pausedUntil = pausedUntilFromError(error as { code?: string; details?: string });
      if (pausedUntil) pauseFeature("display_name", pausedUntil);
      else toast.error("Couldn't save your name. Please try again.");
    }
    setIsSaving(false);
  };

  return (
    <Card title="Profile" onSubmit={askToSave}>
      <div>
        <label className={labelClass}>Email</label>
        <input type="email" value={email} disabled className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Display name</label>
        <input
          type="text"
          value={name}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          disabled={isWaiting}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ms. Cruz"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-text-secondary">
          {isWaiting
            ? `You can change your display name again on ${formatDate(nextNameChangeAt)}.`
            : `Your profile link is made from it. You can change it once every ${DISPLAY_NAME_CHANGE_DAYS} days.`}
        </p>
      </div>
      <button
        type="submit"
        disabled={isSaving || isPaused || isWaiting || name.trim() === displayName}
        className={buttonClass}
      >
        {isSaving && <Spinner size={14} />}
        Save name
      </button>
      {isConfirming && (
        <ConfirmModal
          title="Is this display name final?"
          message={`If "${name.trim()}" is available, it will be your display name, and you'll have to wait ${DISPLAY_NAME_CHANGE_DAYS} days to change it.`}
          confirmLabel="Continue"
          onConfirm={save}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </Card>
  );
}
```

  (If `inputClass` has no disabled look, that's fine: the email box already uses `disabled` with it.)

- [ ] **Step 3: `src/app/account/page.tsx`** — `<ProfileForm email={account.email} displayName={account.displayName} nextNameChangeAt={account.nextNameChangeAt} />`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → no errors; eslint on the 7 changed files → clean; `git grep -n "displayName" src/app/signup` → no matches.

- [ ] **Step 5: Commit** — Tasks 2 + 3 files, "Display name rules: sign up and Account page".

---

### Task 4: Final check (CLAUDE.md)

- [ ] `npx tsc --noEmit`, eslint on changed files; `git diff` next to the spec (zod before save, ConfirmModal/Spinner reused, click-limit system reused, design-system classes); tell the user to apply `20261113000000_display_name_rules.sql` and what to test.
