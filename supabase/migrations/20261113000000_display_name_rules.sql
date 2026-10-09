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
-- So the 30 days and the click limit can't be skipped by writing user_settings directly: the owner can't change
-- display_name or display_name_changed_at, and can't delete their row (which would clear the 30 days). The sign-up
-- trigger, the clearing of unconfirmed accounts' names and the account cleanup don't run as the row's owner, so they
-- pass. Saves of other settings (details, favorites) don't send these columns, so they pass too.
create function public.guard_display_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) = coalesce(new.user_id, old.user_id)
    and coalesce(current_setting('qm.set_display_name', true), '') <> 'on'
    -- In brackets: a bare "then" inside the case would end the if's condition early.
    and (case tg_op
      when 'DELETE' then true
      when 'INSERT' then new.display_name <> '' or new.display_name_changed_at is not null
      else new.display_name is distinct from old.display_name
        or new.display_name_changed_at is distinct from old.display_name_changed_at
    end)
  then
    raise exception 'Change your display name on the Account page.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger user_settings_display_name_guard
  before insert or update of display_name, display_name_changed_at or delete on public.user_settings
  for each row execute function public.guard_display_name();
