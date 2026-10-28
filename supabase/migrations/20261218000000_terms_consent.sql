-- The agree box at sign up, and no hidden copy of the sign up details
-- (docs/superpowers/specs/2026-10-27-privacy-and-terms-design.md).
-- - The sign up form sends terms_version (LEGAL_VERSION in src/lib/legal.ts) once the teacher ticks "I agree to the
--   Terms of Use and Privacy Policy". handle_new_user saves it with the time in user_settings. A teacher can't change
--   these two columns themselves (the "Own settings" policy lets them write their own row): keep_terms_consent puts
--   them back. An account an admin adds from the Supabase dashboard has no agree step, so both stay empty.
-- - The sign up details used to stay in auth.users.raw_user_meta_data (and in login tokens) after handle_new_user
--   copied them into user_settings. Nothing reads them there, and the Privacy Policy promises one copy only, so
--   handle_new_user removes them, and strip_sign_up_details keeps them out if Auth writes the metadata again (for
--   example a repeat sign up of an unconfirmed email).
-- Test: supabase/tests/terms_consent.sql.

alter table public.user_settings
  add column terms_version text check (char_length(terms_version) <= 20),
  add column terms_accepted_at timestamptz;

-- ─── 1. Teachers can't write their own consent record ─────────────────────────────────────────────────────────
-- Only a direct API write (current_user = 'authenticated') is changed: a new row gets none, an update keeps the old
-- one. handle_new_user is security definer, so its insert gets past.
create function public.keep_terms_consent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.terms_version := null;
      new.terms_accepted_at := null;
    else
      new.terms_version := old.terms_version;
      new.terms_accepted_at := old.terms_accepted_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger user_settings_keep_terms_consent
  before insert or update on public.user_settings
  for each row execute function public.keep_terms_consent();

-- ─── 2. Sign up: save the consent, then drop the details from the login record ────────────────────────────────
-- Same as 20261113000000_display_name_rules.sql, plus terms_version / terms_accepted_at, and the last update.
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
  agreed_version text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), '');
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
    (user_id, display_name, first_name, last_name, contact_number, education_level, education_field,
     terms_version, terms_accepted_at)
  values (
    new.id,
    new_name,
    given_name,
    family_name,
    trim(coalesce(new.raw_user_meta_data ->> 'contact_number', '')),
    coalesce(new.raw_user_meta_data ->> 'education_level', ''),
    trim(coalesce(new.raw_user_meta_data ->> 'education_field', '')),
    agreed_version,
    case when agreed_version is not null then now() end
  )
  on conflict (user_id) do nothing;

  update auth.users
  set raw_user_meta_data = raw_user_meta_data - array['first_name', 'last_name', 'contact_number',
    'education_level', 'education_field', 'display_name', 'terms_version']
  where id = new.id;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ─── 3. Keep the details out when Auth writes the metadata again ──────────────────────────────────────────────
create function public.strip_sign_up_details()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.raw_user_meta_data is not null then
    new.raw_user_meta_data := new.raw_user_meta_data - array['first_name', 'last_name', 'contact_number',
      'education_level', 'education_field', 'display_name', 'terms_version'];
  end if;
  return new;
end;
$$;

create trigger strip_sign_up_details
  before update on auth.users
  for each row execute function public.strip_sign_up_details();

revoke execute on function public.keep_terms_consent() from public, anon, authenticated;
revoke execute on function public.strip_sign_up_details() from public, anon, authenticated;
