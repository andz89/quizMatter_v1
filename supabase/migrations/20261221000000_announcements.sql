-- Announcements: the super admin shows a modal and/or a top bar to chosen teachers
-- (docs/superpowers/specs/2026-10-30-announcements-design.md). Notes: the root CLAUDE.md, "Announcements".
-- - announcements: one row per announcement (its text, when it's live, which pages, which teachers). Nobody reads
--   or changes it through the API: the functions below do, and only the super admin changes it.
-- - announcement_dismissals: who closed which part (modal or bar), and when, so a "once" or "daily" one stays
--   closed. "every_visit" writes nothing here (the browser tab remembers it).
-- - announcement_matches(a, user) is the one matching rule (filters empty = everyone; a banned teacher never
--   matches; a teacher with that detail empty doesn't match a filter on it).
-- - maintenance_status() also returns announcements_key, so the app learns there is something to show with the
--   check it already makes (empty = nothing live, so no extra call).
-- - used_photo_srcs() also keeps the modal images, so the weekly photo cleanup doesn't delete them.
-- - The Admin log gets announcement_saved and announcement_deleted (target_type 'announcement').
-- Test: supabase/tests/announcements.sql.

-- ─── 1. The tables ────────────────────────────────────────────────────────────────────────────────────────────
-- A word list (town words, field words): at most 20 words, each 1–60 characters and not only spaces.
create function public.announcement_words_ok(words text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(words), 0) <= 20
    and not exists (select 1 from unnest(words) w where w is null or btrim(w) = '' or char_length(w) > 60);
$$;

-- Every name must be a province from the Province dropdown (is_province).
create function public.announcement_provinces_ok(names text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (select 1 from unnest(names) n where n is null or not public.is_province(n));
$$;

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  -- For the admin's list only; teachers never see it.
  name text not null check (char_length(name) between 1 and 100),
  is_on boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  show_modal boolean not null default false,
  modal_html text not null default '' check (char_length(modal_html) <= 20000),
  modal_close_after int not null default 0 check (modal_close_after between 0 and 60),
  show_bar boolean not null default false,
  bar_html text not null default '' check (char_length(bar_html) <= 1000),
  bar_close_after int not null default 0 check (bar_close_after between 0 and 60),
  repeat text not null default 'once' check (repeat in ('once', 'daily', 'every_visit')),
  -- Page group keys (pageGroup in src/lib/announcements.ts), or {all}.
  pages text[] not null default '{all}' check (cardinality(pages) > 0 and pages <@ array[
    'all', 'my_presentations', 'quizmatter', 'other_teachers', 'saved', 'liked', 'reviews_submissions', 'search',
    'presentation_view', 'editor', 'account', 'teacher_profiles'
  ]),
  -- The filters. An empty list or an empty number = everyone.
  genders text[] not null default '{}' check (genders <@ array['male', 'female']),
  age_min int check (age_min between 18 and 100),
  age_max int check (age_max between 18 and 100),
  provinces text[] not null default '{}' check (public.announcement_provinces_ok(provinces)),
  town_words text[] not null default '{}' check (public.announcement_words_ok(town_words)),
  education_levels text[] not null default '{}'
    check (education_levels <@ array['bachelor', 'master', 'doctorate', 'other']),
  field_words text[] not null default '{}' check (public.announcement_words_ok(field_words)),
  presentations_min int check (presentations_min between 0 and 50),
  presentations_max int check (presentations_max between 0 and 50),
  roles text[] not null default '{}' check (roles <@ array['teacher', 'editor', 'admin']),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (age_min is null or age_max is null or age_min <= age_max),
  check (presentations_min is null or presentations_max is null or presentations_min <= presentations_max),
  -- At least one part, and a part that is on needs text.
  check (show_modal or show_bar),
  check (not show_modal or btrim(modal_html) <> ''),
  check (not show_bar or btrim(bar_html) <> '')
);

create table public.announcement_dismissals (
  announcement_id uuid references public.announcements (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  part text check (part in ('modal', 'bar')),
  closed_at timestamptz not null default now(),
  primary key (announcement_id, user_id, part)
);

-- For deleting an account (its rows go by user_id).
create index announcement_dismissals_user_id on public.announcement_dismissals (user_id);

-- No policies: only the functions below read and change them.
alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;
revoke all on public.announcements from anon, authenticated, public;
revoke all on public.announcement_dismissals from anon, authenticated, public;

-- ─── 2. Live: on, started (or no start) and not ended (or no end) ─────────────────────────────────────────────
create function public.announcement_is_live(a public.announcements)
returns boolean
language sql
stable
set search_path = ''
as $$
  select a.is_on and (a.starts_at is null or a.starts_at <= now()) and (a.ends_at is null or a.ends_at > now());
$$;

-- ─── 3. The matching rule (one place, used by every function below) ───────────────────────────────────────────
-- Reads the teacher's user_settings. Each filter passes when it's empty; otherwise the detail must be there and
-- match. Words match when the town (or field/major) contains any of them, ignoring case. Presentations: their own,
-- not shared copies. Roles: editor = in editors, admin = in admins, teacher = neither.
create function public.announcement_matches(a public.announcements, uid uuid)
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
      and (coalesce(cardinality(a.provinces), 0) = 0 or s.province = any (a.provinces))
      and (coalesce(cardinality(a.town_words), 0) = 0 or (s.town <> '' and exists (
        select 1 from unnest(a.town_words) w where position(lower(w) in lower(s.town)) > 0)))
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

-- ─── 4. Saving, turning on and off, deleting (super admin only) ───────────────────────────────────────────────
-- At most 20 on and not ended (live or waiting to start). Checked after the write, under a lock, so two saves at
-- once can't both get past it.
create function public.check_announcement_limit()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.announcements'));
  if (select count(*) from public.announcements a where a.is_on and (a.ends_at is null or a.ends_at > now())) > 20 then
    raise exception 'At most 20 announcements can be on at once.' using errcode = '22023';
  end if;
end;
$$;

-- `a` has the column names as keys; no id (or null) = a new one. updated_at takes the clock's time (not the
-- transaction's), so announcements_key changes with every save.
create function public.save_announcement(a jsonb)
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
      name, is_on, starts_at, ends_at, show_modal, modal_html, modal_close_after, show_bar, bar_html,
      bar_close_after, repeat, pages, genders, age_min, age_max, provinces, town_words, education_levels,
      field_words, presentations_min, presentations_max, roles, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, r.modal_html, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max, r.provinces, r.town_words,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, auth.uid(), now(),
      clock_timestamp()
    )
    returning id into saved_id;
  else
    update public.announcements x set
      name = btrim(r.name), is_on = r.is_on, starts_at = r.starts_at, ends_at = r.ends_at,
      show_modal = r.show_modal, modal_html = r.modal_html, modal_close_after = r.modal_close_after,
      show_bar = r.show_bar, bar_html = r.bar_html, bar_close_after = r.bar_close_after, repeat = r.repeat,
      pages = r.pages, genders = r.genders, age_min = r.age_min, age_max = r.age_max, provinces = r.provinces,
      town_words = r.town_words, education_levels = r.education_levels, field_words = r.field_words,
      presentations_min = r.presentations_min, presentations_max = r.presentations_max, roles = r.roles,
      updated_at = clock_timestamp()
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

create function public.set_announcement_on(target uuid, turn_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  update public.announcements set is_on = turn_on, updated_at = clock_timestamp()
  where id = target
  returning name into saved_name;
  if saved_name is null then
    raise exception 'This announcement was deleted.' using errcode = 'P0002';
  end if;

  perform public.check_announcement_limit();
  perform public.log_admin_action(
    'announcement_saved', 'announcement', target::text, saved_name, jsonb_build_object('is_on', turn_on)
  );
end;
$$;

-- Its dismissals go with it (on delete cascade). Already gone: nothing happens.
create function public.delete_announcement(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  delete from public.announcements where id = target returning name into deleted_name;
  if deleted_name is not null then
    perform public.log_admin_action('announcement_deleted', 'announcement', target::text, deleted_name, null);
  end if;
end;
$$;

-- ─── 5. Reading them ──────────────────────────────────────────────────────────────────────────────────────────
-- Admin → Announcements: every row, newest first, with its status, how many accounts match now, and how many
-- closed each part.
create function public.admin_announcements()
returns table (
  id uuid, name text, is_on boolean, starts_at timestamptz, ends_at timestamptz,
  show_modal boolean, modal_html text, modal_close_after int, show_bar boolean, bar_html text, bar_close_after int,
  repeat text, pages text[], genders text[], age_min int, age_max int, provinces text[], town_words text[],
  education_levels text[], field_words text[], presentations_min int, presentations_max int, roles text[],
  created_by uuid, created_at timestamptz, updated_at timestamptz,
  status text, matched int, closed_modal int, closed_bar int
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
    a.show_modal, a.modal_html, a.modal_close_after, a.show_bar, a.bar_html, a.bar_close_after,
    a.repeat, a.pages, a.genders, a.age_min, a.age_max, a.provinces, a.town_words,
    a.education_levels, a.field_words, a.presentations_min, a.presentations_max, a.roles,
    a.created_by, a.created_at, a.updated_at,
    case
      when a.ends_at is not null and a.ends_at <= now() then 'ended'
      when not a.is_on then 'off'
      when a.starts_at is not null and a.starts_at > now() then 'scheduled'
      else 'live'
    end,
    (select count(*) from public.user_settings s where public.announcement_matches(a, s.user_id))::int,
    (select count(*) from public.announcement_dismissals d where d.announcement_id = a.id and d.part = 'modal')::int,
    (select count(*) from public.announcement_dismissals d where d.announcement_id = a.id and d.part = 'bar')::int
  from public.announcements a
  order by a.created_at desc, a.id;
end;
$$;

-- The form's "Matches about N teachers now". `a` has the filter columns as keys (missing ones = no filter).
create function public.announcement_audience(a jsonb)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.announcements := jsonb_populate_record(null::public.announcements, a);
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  return (select count(*) from public.user_settings s where public.announcement_matches(r, s.user_id));
end;
$$;

-- The caller's live, matching announcements, newest first. A part they closed comes back off (with no text): once
-- = they closed it at all, daily = they closed it today (Philippine date). Rows with both parts off are left out.
-- Never the targets or the name. Logged out or banned: none.
create function public.my_announcements()
returns table (
  id uuid, show_modal boolean, modal_html text, modal_close_after int, show_bar boolean, bar_html text,
  bar_close_after int, repeat text, pages text[], created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select
      a.*,
      a.show_modal and not exists (
        select 1 from public.announcement_dismissals d
        where d.announcement_id = a.id and d.user_id = (select auth.uid()) and d.part = 'modal'
          and (a.repeat = 'once'
            or (a.repeat = 'daily' and (d.closed_at at time zone 'Asia/Manila')::date = public.manila_today()))
      ) as modal_open,
      a.show_bar and not exists (
        select 1 from public.announcement_dismissals d
        where d.announcement_id = a.id and d.user_id = (select auth.uid()) and d.part = 'bar'
          and (a.repeat = 'once'
            or (a.repeat = 'daily' and (d.closed_at at time zone 'Asia/Manila')::date = public.manila_today()))
      ) as bar_open
    from public.announcements a
    where public.announcement_is_live(a) and public.announcement_matches(a, (select auth.uid()))
  )
  select
    m.id, m.modal_open, case when m.modal_open then m.modal_html else '' end, m.modal_close_after,
    m.bar_open, case when m.bar_open then m.bar_html else '' end, m.bar_close_after,
    m.repeat, m.pages, m.created_at
  from mine m
  where m.modal_open or m.bar_open
  order by m.created_at desc, m.id;
$$;

-- The caller closed a part. Saves the time (again on a later close). Nothing for every_visit or an unknown id.
create function public.dismiss_announcement(target uuid, part text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please log in.' using errcode = '42501';
  end if;
  if part is null or part not in ('modal', 'bar') then
    raise exception 'Unknown part.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.announcements a where a.id = target and a.repeat <> 'every_visit') then
    return;
  end if;

  insert into public.announcement_dismissals (announcement_id, user_id, part, closed_at)
  values (target, auth.uid(), dismiss_announcement.part, now())
  on conflict on constraint announcement_dismissals_pkey do update set closed_at = excluded.closed_at;
end;
$$;

-- ─── 6. maintenance_status: also the announcements key ────────────────────────────────────────────────────────
-- Same as 20261219000000_maintenance.sql, plus announcements_key: null when nothing is live; otherwise an md5 of
-- the live ones' ids and updated_at, so it changes when one is added, edited, turned on or off, starts or ends.
create or replace function public.maintenance_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_on', m.is_on,
    'message', m.message,
    'started_at', m.started_at,
    'planned_at', case when not m.is_on and m.planned_at > now() then m.planned_at end,
    'announcements_key', (
      select md5(string_agg(a.id::text || a.updated_at::text, ',' order by a.id))
      from public.announcements a
      where public.announcement_is_live(a)
    )
  )
  from public.maintenance m;
$$;

-- ─── 7. Photo cleanup: modal images count as used ─────────────────────────────────────────────────────────────
-- Same as 20261214000000_profile_photos.sql, plus every <img src="…"> in announcements.modal_html.
create or replace function public.used_photo_srcs()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct used.src), '{}')
  from (
    select p.src from public.photos p
    union
    select sp.src from public.shared_photos sp
    union
    select slp.src from public.slide_photos slp
    union
    select unnest(public.slide_photo_srcs(r.draft)) from public.presentation_reviews r where r.draft is not null
    union
    select pp.src from public.profile_photos pp where pp.src <> ''
    union
    select (regexp_matches(a.modal_html, '<img[^>]+src="([^"]+)"', 'g'))[1] from public.announcements a
  ) as used (src);
$$;

-- ─── 8. The Admin log's new actions ───────────────────────────────────────────────────────────────────────────
-- Same lists as 20261219000000_maintenance.sql, plus the two announcement actions and the 'announcement' target.
-- Same keys as ADMIN_ACTION_LABELS in src/lib/adminActions.ts.
alter table public.admin_actions
  drop constraint admin_actions_action_check,
  add constraint admin_actions_action_check check (action in (
    'review_published', 'review_sent_back', 'review_canceled', 'review_opened', 'review_closed',
    'submission_approved', 'submission_sent_back',
    'presentation_shared', 'presentation_unshared', 'presentation_moved', 'presentation_hidden',
    'presentation_unhidden', 'reports_dismissed', 'presentation_deleted',
    'teacher_banned', 'ban_updated', 'teacher_unbanned', 'editor_added', 'editor_removed', 'pause_released',
    'category_created', 'category_renamed', 'category_deleted',
    'photo_deleted',
    'profile_photo_removed',
    'maintenance_on', 'maintenance_off', 'maintenance_announced',
    'announcement_saved', 'announcement_deleted'
  )),
  drop constraint admin_actions_target_type_check,
  add constraint admin_actions_target_type_check check (
    target_type in ('presentation', 'user', 'category', 'photo', 'site', 'announcement')
  );

-- ─── 9. Who may call what ─────────────────────────────────────────────────────────────────────────────────────
revoke execute on function public.save_announcement(jsonb) from public, anon;
grant execute on function public.save_announcement(jsonb) to authenticated;
revoke execute on function public.set_announcement_on(uuid, boolean) from public, anon;
grant execute on function public.set_announcement_on(uuid, boolean) to authenticated;
revoke execute on function public.delete_announcement(uuid) from public, anon;
grant execute on function public.delete_announcement(uuid) to authenticated;
revoke execute on function public.admin_announcements() from public, anon;
grant execute on function public.admin_announcements() to authenticated;
revoke execute on function public.announcement_audience(jsonb) from public, anon;
grant execute on function public.announcement_audience(jsonb) to authenticated;
revoke execute on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated;
revoke execute on function public.dismiss_announcement(uuid, text) from public, anon;
grant execute on function public.dismiss_announcement(uuid, text) to authenticated;

-- Helpers: only the functions above use them (they run as the owner).
revoke execute on function public.announcement_words_ok(text[]) from public, anon, authenticated;
revoke execute on function public.announcement_provinces_ok(text[]) from public, anon, authenticated;
revoke execute on function public.announcement_is_live(public.announcements) from public, anon, authenticated;
revoke execute on function public.announcement_matches(public.announcements, uuid) from public, anon, authenticated;
revoke execute on function public.check_announcement_limit() from public, anon, authenticated;
