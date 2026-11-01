-- Remove the address: the province and town (docs/superpowers/specs/2026-11-01-remove-address-design.md).
-- - Sign up, the Account page and the profile no longer ask for or show them, and Announcements no longer filter by
--   them, so their columns are dropped and every saved province and town is deleted for good.
-- - The functions that used them are made again without them first (Postgres doesn't notice a function that still
--   names a dropped column until it runs): handle_new_user, teacher_profile, admin_teacher_breakdown,
--   announcement_count, announcement_matches, save_announcement, admin_announcements.
-- - handle_new_user and strip_sign_up_details still remove the 'province' and 'town' keys from the login record, so
--   an old open sign up tab that still sends them leaves nothing behind. save_announcement and announcement_audience
--   ignore an old admin tab's 'provinces' / 'town_words' keys (jsonb_populate_record skips unknown keys).
-- - Apply it AFTER the app deploys: the older app reads province, town and town_public on every page (getAccount).
-- Test: supabase/tests/age_gender_address.sql.

-- ─── 1. Sign up: no province or town ──────────────────────────────────────────────────────────────────────────
-- Same as 20261220000000_age_gender_address.sql, minus the province and town.
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
  insert into public.user_settings
    (user_id, display_name, first_name, last_name, contact_number, education_level, education_field,
     terms_version, terms_accepted_at, birth_date, gender)
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
    given_gender
  )
  on conflict (user_id) do nothing;

  -- 'province' and 'town' stay in the list: an old open sign up tab may still send them.
  update auth.users
  set raw_user_meta_data = raw_user_meta_data - array['first_name', 'last_name', 'contact_number',
    'education_level', 'education_field', 'display_name', 'terms_version', 'birth_date', 'gender', 'province',
    'town']
  where id = new.id;
  return new;
end;
$$;

-- ─── 2. The profile: no town or province ──────────────────────────────────────────────────────────────────────
-- Same as 20261220000000_age_gender_address.sql, minus town, province and town_public.
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
  bio_public boolean
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
    v.bio
  from public.user_settings s
  left join public.profile_photos pp on pp.user_id = s.user_id
  cross join lateral (
    select
      s.full_name_public or e.is_editor as full_name,
      s.education_public or e.is_editor as education,
      s.bio_public or e.is_editor as bio,
      s.user_id = (select auth.uid()) as mine
    from (select exists (select 1 from public.editors ed where ed.user_id = s.user_id) as is_editor) e
  ) v
  where teacher_profile.slug <> ''
    and s.profile_slug = teacher_profile.slug
    and public.profile_is_visible(s.user_id);
$$;

revoke execute on function public.teacher_profile(text) from anon, public;
grant execute on function public.teacher_profile(text) to authenticated;

-- ─── 3. The counts for Admin → Overview: age group and gender only ────────────────────────────────────────────
create or replace function public.admin_teacher_breakdown()
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

-- ─── 4. Announcements: no province or town filters ────────────────────────────────────────────────────────────
-- Same as 20261224000000_announcement_fast_counts.sql, minus the province and town lines. Still the same rule as
-- announcement_matches below (supabase/tests/announcement_fast_counts.sql checks they agree).
create or replace function public.announcement_count(a public.announcements)
returns int
language plpgsql
stable
set search_path = ''
as $$
declare
  today date := public.manila_today();
  wants_presentations boolean := a.presentations_min is not null or a.presentations_max is not null;
begin
  return (
    select count(*)
    from public.user_settings s
    left join (
      select p.owner_id, count(*) as n
      from public.presentations p
      where wants_presentations and p.shared_from is null
      group by p.owner_id
    ) own on own.owner_id = s.user_id
    where not exists (select 1 from public.banned_users b where b.user_id = s.user_id)
      and (coalesce(cardinality(a.genders), 0) = 0 or s.gender = any (a.genders))
      and (a.age_min is null or (s.birth_date is not null and
        extract(year from today)::int - extract(year from s.birth_date)::int
        - case when (extract(month from today), extract(day from today))
            < (extract(month from s.birth_date), extract(day from s.birth_date)) then 1 else 0 end >= a.age_min))
      and (a.age_max is null or (s.birth_date is not null and
        extract(year from today)::int - extract(year from s.birth_date)::int
        - case when (extract(month from today), extract(day from today))
            < (extract(month from s.birth_date), extract(day from s.birth_date)) then 1 else 0 end <= a.age_max))
      and (coalesce(cardinality(a.education_levels), 0) = 0 or s.education_level = any (a.education_levels))
      and (coalesce(cardinality(a.field_words), 0) = 0 or (s.education_field <> '' and exists (
        select 1 from unnest(a.field_words) w where position(lower(w) in lower(s.education_field)) > 0)))
      and (not wants_presentations
        or coalesce(own.n, 0) between coalesce(a.presentations_min, 0) and coalesce(a.presentations_max, 2147483647))
      and (coalesce(cardinality(a.roles), 0) = 0
        or ('editor' = any (a.roles) and exists (select 1 from public.editors e where e.user_id = s.user_id))
        or ('admin' = any (a.roles) and exists (select 1 from public.admins ad where ad.user_id = s.user_id))
        or ('teacher' = any (a.roles)
          and not exists (select 1 from public.editors e where e.user_id = s.user_id)
          and not exists (select 1 from public.admins ad where ad.user_id = s.user_id)))
  );
end;
$$;

-- Same as 20261221000000_announcements.sql, minus the province and town lines.
create or replace function public.announcement_matches(a public.announcements, uid uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_settings s
    where s.user_id = uid
      and not exists (select 1 from public.banned_users b where b.user_id = uid)
      and (coalesce(cardinality(a.genders), 0) = 0 or s.gender = any (a.genders))
      and (a.age_min is null
        or (s.birth_date is not null and public.age_on(s.birth_date, public.manila_today()) >= a.age_min))
      and (a.age_max is null
        or (s.birth_date is not null and public.age_on(s.birth_date, public.manila_today()) <= a.age_max))
      and (coalesce(cardinality(a.education_levels), 0) = 0 or s.education_level = any (a.education_levels))
      and (coalesce(cardinality(a.field_words), 0) = 0 or (s.education_field <> '' and exists (
        select 1 from unnest(a.field_words) w where position(lower(w) in lower(s.education_field)) > 0)))
      and ((a.presentations_min is null and a.presentations_max is null) or (
        select count(*) from public.presentations p where p.owner_id = uid and p.shared_from is null
      ) between coalesce(a.presentations_min, 0) and coalesce(a.presentations_max, 2147483647))
      and (coalesce(cardinality(a.roles), 0) = 0
        or ('editor' = any (a.roles) and exists (select 1 from public.editors e where e.user_id = uid))
        or ('admin' = any (a.roles) and exists (select 1 from public.admins ad where ad.user_id = uid))
        or ('teacher' = any (a.roles)
          and not exists (select 1 from public.editors e where e.user_id = uid)
          and not exists (select 1 from public.admins ad where ad.user_id = uid)))
  );
$$;

-- Same as 20261225000000_announcement_post.sql, minus provinces and town_words.
create or replace function public.save_announcement(a jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.announcements := jsonb_populate_record(null::public.announcements, a);
  saved_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  if r.id is null then
    insert into public.announcements (
      name, is_on, starts_at, ends_at, show_modal, modal_text, modal_attachment, modal_close_after, show_bar, bar_html,
      bar_close_after, repeat, pages, genders, age_min, age_max, education_levels,
      field_words, presentations_min, presentations_max, roles, modal_size, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, coalesce(r.modal_text, ''), r.modal_attachment, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'), auth.uid(), now(),
      clock_timestamp()
    )
    returning id into saved_id;
  else
    update public.announcements x set
      name = btrim(r.name), is_on = r.is_on, starts_at = r.starts_at, ends_at = r.ends_at,
      show_modal = r.show_modal, modal_text = coalesce(r.modal_text, ''), modal_attachment = r.modal_attachment, modal_close_after = r.modal_close_after,
      show_bar = r.show_bar, bar_html = r.bar_html, bar_close_after = r.bar_close_after, repeat = r.repeat,
      pages = r.pages, genders = r.genders, age_min = r.age_min, age_max = r.age_max,
      education_levels = r.education_levels, field_words = r.field_words,
      presentations_min = r.presentations_min, presentations_max = r.presentations_max, roles = r.roles,
      modal_size = coalesce(r.modal_size, 'large'), updated_at = clock_timestamp(),
      -- Ending later again after its cleanup: its closed rows start over (they were deleted).
      closed_cleared_at = case when r.ends_at is null or r.ends_at > now() then null else x.closed_cleared_at end
    where x.id = r.id
    returning x.id into saved_id;
    if saved_id is null then
      raise exception 'This announcement was deleted.' using errcode = 'P0002';
    end if;
  end if;

  perform public.check_announcement_limit();
  perform public.log_admin_action('announcement_saved', 'announcement', saved_id::text, btrim(r.name), null);
  return saved_id;
end;
$$;

drop function public.admin_announcements();
-- Admin → Announcements: every row, newest first, with its status and its kept counts (counted_at = when).
-- Same as 20261225000000_announcement_post.sql, minus provinces and town_words.
create function public.admin_announcements()
returns table (
  id uuid, name text, is_on boolean, starts_at timestamptz, ends_at timestamptz,
  show_modal boolean, modal_text text, modal_attachment jsonb, modal_close_after int, show_bar boolean, bar_html text, bar_close_after int,
  repeat text, pages text[], genders text[], age_min int, age_max int,
  education_levels text[], field_words text[], presentations_min int, presentations_max int, roles text[],
  created_by uuid, created_at timestamptz, updated_at timestamptz, modal_size text,
  status text, matched int, closed_modal int, closed_bar int, counted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  return query
  select
    a.id, a.name, a.is_on, a.starts_at, a.ends_at,
    a.show_modal, a.modal_text, a.modal_attachment, a.modal_close_after, a.show_bar, a.bar_html, a.bar_close_after,
    a.repeat, a.pages, a.genders, a.age_min, a.age_max,
    a.education_levels, a.field_words, a.presentations_min, a.presentations_max, a.roles,
    a.created_by, a.created_at, a.updated_at, a.modal_size,
    case
      when a.ends_at is not null and a.ends_at <= now() then 'ended'
      when not a.is_on then 'off'
      when a.starts_at is not null and a.starts_at > now() then 'scheduled'
      else 'live'
    end,
    a.matched_count, a.closed_modal_count, a.closed_bar_count, a.counted_at
  from public.announcements a
  order by a.created_at desc, a.id;
end;
$$;

revoke execute on function public.admin_announcements() from public, anon;
grant execute on function public.admin_announcements() to authenticated;

-- ─── 5. Drop the columns (their checks go with them) and the helpers only they used ───────────────────────────
alter table public.user_settings
  drop column province,
  drop column town,
  drop column town_public;

alter table public.announcements
  drop column provinces,
  drop column town_words;

drop function public.announcement_provinces_ok(text[]);
drop function public.is_province(text);

revoke execute on function public.handle_new_user() from public, anon, authenticated;
