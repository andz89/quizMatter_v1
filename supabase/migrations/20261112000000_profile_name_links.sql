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
