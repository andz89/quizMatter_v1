-- Birthday, gender, province and town at sign up (docs/superpowers/specs/2026-10-30-age-gender-address-design.md).
-- - Sign up asks for all four (required by the form's zod check). handle_new_user copies them from the sign up
--   metadata into user_settings, then removes them from the login record, like the other details. A bad one (e.g. a
--   script sending "other" or a 10-year-old's birthday) is saved empty instead, so the account is still made.
-- - The birthday: 18 to 100 years old on today's date in the Philippines (check_birth_date, error QMAGE). age_on is
--   the same math as ageOn in src/lib/age.ts.
-- - The province: one of the names in src/lib/provinces.ts (is_province; provinces.test.ts keeps the two lists
--   equal), so the counts per province are clean.
-- - The birthday and gender never leave the database for anyone but the teacher and admins: teacher_profile doesn't
--   return them, and the "Own settings" policy keeps other teachers out of the row. The town and province show on
--   the profile unless the teacher turns town_public off (an editor's always show, like their other details).
-- - admin_teacher_breakdown: counts per province, age group and gender for Admin → Overview (admins only).
-- Test: supabase/tests/age_gender_address.sql.

-- ─── 1. The columns ───────────────────────────────────────────────────────────────────────────────────────────
-- A name from the Province dropdown (src/lib/provinces.ts; provinces.test.ts keeps the two lists equal).
create function public.is_province(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name = any (array[
    -- provinces:start
    'Abra', 'Agusan del Norte', 'Agusan del Sur', 'Aklan', 'Albay', 'Antique', 'Apayao', 'Aurora', 'Basilan',
    'Bataan', 'Batanes', 'Batangas', 'Benguet', 'Biliran', 'Bohol', 'Bukidnon', 'Bulacan', 'Cagayan',
    'Camarines Norte', 'Camarines Sur', 'Camiguin', 'Capiz', 'Catanduanes', 'Cavite', 'Cebu', 'Cotabato',
    'Davao de Oro', 'Davao del Norte', 'Davao del Sur', 'Davao Occidental', 'Davao Oriental', 'Dinagat Islands',
    'Eastern Samar', 'Guimaras', 'Ifugao', 'Ilocos Norte', 'Ilocos Sur', 'Iloilo', 'Isabela', 'Kalinga', 'La Union',
    'Laguna', 'Lanao del Norte', 'Lanao del Sur', 'Leyte', 'Maguindanao del Norte', 'Maguindanao del Sur',
    'Marinduque', 'Masbate', 'Metro Manila', 'Misamis Occidental', 'Misamis Oriental', 'Mountain Province',
    'Negros Occidental', 'Negros Oriental', 'Northern Samar', 'Nueva Ecija', 'Nueva Vizcaya', 'Occidental Mindoro',
    'Oriental Mindoro', 'Palawan', 'Pampanga', 'Pangasinan', 'Quezon', 'Quirino', 'Rizal', 'Romblon', 'Samar',
    'Sarangani', 'Siquijor', 'Sorsogon', 'South Cotabato', 'Southern Leyte', 'Sultan Kudarat', 'Sulu',
    'Surigao del Norte', 'Surigao del Sur', 'Tarlac', 'Tawi-Tawi', 'Zambales', 'Zamboanga del Norte',
    'Zamboanga del Sur', 'Zamboanga Sibugay', 'Outside the Philippines'
    -- provinces:end
  ]);
$$;

alter table public.user_settings
  add column birth_date date,
  add column gender text not null default '' check (gender in ('', 'male', 'female')),
  add column province text not null default '' check (province = '' or public.is_province(province)),
  add column town text not null default '' check (char_length(town) <= 60),
  add column town_public boolean not null default true;

-- ─── 2. Age math ──────────────────────────────────────────────────────────────────────────────────────────────
-- Today's date in the Philippines.
create function public.manila_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

-- The age in whole years on `today`: the years between, minus 1 if the birthday hasn't come yet that year (a
-- 29 February birthday turns a year older on 1 March in other years). Same as ageOn in src/lib/age.ts.
create function public.age_on(birth date, today date)
returns int
language sql
immutable
set search_path = ''
as $$
  select extract(year from today)::int - extract(year from birth)::int
    - case when (extract(month from today), extract(day from today)) < (extract(month from birth), extract(day from birth))
        then 1 else 0 end;
$$;

-- ─── 3. The birthday rule ─────────────────────────────────────────────────────────────────────────────────────
create function public.check_birth_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.birth_date is not null and (
    new.birth_date > public.manila_today()
    or public.age_on(new.birth_date, public.manila_today()) not between 18 and 100
  ) then
    raise exception 'Enter your real birthday. You must be 18 to 100 years old.' using errcode = 'QMAGE';
  end if;
  return new;
end;
$$;

create trigger user_settings_check_birth_date
  before insert or update of birth_date on public.user_settings
  for each row execute function public.check_birth_date();

-- ─── 4. Sign up: copy the new details, then drop them from the login record ───────────────────────────────────
-- Same as 20261218000000_terms_consent.sql, plus birth_date, gender, province and town.
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
  birth_text text := coalesce(new.raw_user_meta_data ->> 'birth_date', '');
  birth date;
  given_gender text := coalesce(new.raw_user_meta_data ->> 'gender', '');
  given_province text := coalesce(new.raw_user_meta_data ->> 'province', '');
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

  -- A bad detail is saved empty, so the account is still made (the form checks them first).
  if birth_text ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      birth := birth_text::date;
    exception when others then
      birth := null;
    end;
  end if;
  if birth is not null and (birth > public.manila_today()
      or public.age_on(birth, public.manila_today()) not between 18 and 100) then
    birth := null;
  end if;
  if given_gender not in ('male', 'female') then
    given_gender := '';
  end if;
  if not public.is_province(given_province) then
    given_province := '';
  end if;
  insert into public.user_settings
    (user_id, display_name, first_name, last_name, contact_number, education_level, education_field,
     terms_version, terms_accepted_at, birth_date, gender, province, town)
  values (
    new.id,
    new_name,
    given_name,
    family_name,
    trim(coalesce(new.raw_user_meta_data ->> 'contact_number', '')),
    coalesce(new.raw_user_meta_data ->> 'education_level', ''),
    trim(coalesce(new.raw_user_meta_data ->> 'education_field', '')),
    agreed_version,
    case when agreed_version is not null then now() end,
    birth,
    given_gender,
    given_province,
    left(trim(coalesce(new.raw_user_meta_data ->> 'town', '')), 60)
  )
  on conflict (user_id) do nothing;

  update auth.users
  set raw_user_meta_data = raw_user_meta_data - array['first_name', 'last_name', 'contact_number',
    'education_level', 'education_field', 'display_name', 'terms_version', 'birth_date', 'gender', 'province',
    'town']
  where id = new.id;
  return new;
end;
$$;

-- Same as 20261218000000_terms_consent.sql, plus the four new keys.
create or replace function public.strip_sign_up_details()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.raw_user_meta_data is not null then
    new.raw_user_meta_data := new.raw_user_meta_data - array['first_name', 'last_name', 'contact_number',
      'education_level', 'education_field', 'display_name', 'terms_version', 'birth_date', 'gender', 'province',
      'town'];
  end if;
  return new;
end;
$$;

-- ─── 5. The profile: the town and province, never the birthday or gender ──────────────────────────────────────
-- Same as 20261215000000_profile_privacy.sql, plus town, province and town_public ("others see this": the saved
-- switch, or true for an editor).
drop function public.teacher_profile(text);
create function public.teacher_profile(slug text)
returns table (
  display_name text,
  first_name text,
  last_name text,
  education_level text,
  education_field text,
  bio text,
  photo_src text,
  full_name_public boolean,
  education_public boolean,
  bio_public boolean,
  town text,
  province text,
  town_public boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.display_name,
    case when v.full_name or v.mine then coalesce(s.first_name, '') else '' end,
    case when v.full_name or v.mine then coalesce(s.last_name, '') else '' end,
    case when v.education or v.mine then coalesce(s.education_level, '') else '' end,
    case when v.education or v.mine then coalesce(s.education_field, '') else '' end,
    case when v.bio or v.mine then coalesce(s.bio, '') else '' end,
    coalesce(pp.src, ''),
    v.full_name,
    v.education,
    v.bio,
    case when v.town or v.mine then s.town else '' end,
    case when v.town or v.mine then s.province else '' end,
    v.town
  from public.user_settings s
  left join public.profile_photos pp on pp.user_id = s.user_id
  cross join lateral (
    select
      s.full_name_public or e.is_editor as full_name,
      s.education_public or e.is_editor as education,
      s.bio_public or e.is_editor as bio,
      s.town_public or e.is_editor as town,
      s.user_id = (select auth.uid()) as mine
    from (select exists (select 1 from public.editors ed where ed.user_id = s.user_id) as is_editor) e
  ) v
  where teacher_profile.slug <> ''
    and s.profile_slug = teacher_profile.slug
    and public.profile_is_visible(s.user_id);
$$;

revoke execute on function public.teacher_profile(text) from anon, public;
grant execute on function public.teacher_profile(text) to authenticated;

-- ─── 6. The counts for Admin → Overview ───────────────────────────────────────────────────────────────────────
-- One row per (kind, label): kind is 'province', 'age' or 'gender'; label '' = not given. Every settings row counts.
create function public.admin_teacher_breakdown()
returns table (kind text, label text, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  return query
    select 'province', s.province, count(*) from public.user_settings s group by s.province
    union all
    select 'age', a.label, count(*)
    from public.user_settings s
    cross join lateral (
      select case
        when s.birth_date is null then ''
        when public.age_on(s.birth_date, public.manila_today()) < 25 then '18–24'
        when public.age_on(s.birth_date, public.manila_today()) < 35 then '25–34'
        when public.age_on(s.birth_date, public.manila_today()) < 45 then '35–44'
        when public.age_on(s.birth_date, public.manila_today()) < 55 then '45–54'
        else '55+'
      end as label
    ) a
    group by a.label
    union all
    select 'gender', s.gender, count(*) from public.user_settings s group by s.gender;
end;
$$;

revoke execute on function public.admin_teacher_breakdown() from anon, public;
grant execute on function public.admin_teacher_breakdown() to authenticated;

revoke execute on function public.check_birth_date() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.strip_sign_up_details() from public, anon, authenticated;
