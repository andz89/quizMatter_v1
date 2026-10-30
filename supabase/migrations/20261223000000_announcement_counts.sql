-- Announcement counts kept on the row, and the cleanup of old "closed" rows, so neither grows with the number of
-- teachers on every page load (notes: the root CLAUDE.md, "Announcements").
-- - announcements.matched_count / closed_modal_count / closed_bar_count / counted_at: counted when the announcement
--   is saved and when the super admin presses "Count again" (recount_announcement), never on the list's page load.
--   Counting matches runs the matching rule over every account, so it's slow with many teachers.
-- - cleanup_announcement_dismissals() (the daily timer, secret key only): for an announcement that ended more than 30
--   days ago it keeps the closed counts, deletes its announcement_dismissals rows (it never shows again, so they're
--   no longer needed) and sets closed_cleared_at. Its closed counts stay as they were from then on.
-- - dismiss_announcement writes only for a live announcement, so ended ones don't fill up again.
-- - admin_announcements reads the kept numbers (and returns counted_at).
-- Test: supabase/tests/announcement_counts.sql.

alter table public.announcements
  add column matched_count int,
  add column closed_modal_count int not null default 0,
  add column closed_bar_count int not null default 0,
  add column counted_at timestamptz,
  add column closed_cleared_at timestamptz;

-- Counts one announcement now: how many accounts match it, and (until its cleanup) how many closed each part.
-- Doesn't change updated_at, so the announcements key stays the same.
create function public.count_announcement(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.announcements;
begin
  select * into a from public.announcements where id = target;
  if not found then
    return;
  end if;
  update public.announcements x set
    matched_count = (select count(*) from public.user_settings s where public.announcement_matches(a, s.user_id)),
    closed_modal_count = case when x.closed_cleared_at is null then (select count(*) from public.announcement_dismissals d
      where d.announcement_id = target and d.part = 'modal') else x.closed_modal_count end,
    closed_bar_count = case when x.closed_cleared_at is null then (select count(*) from public.announcement_dismissals d
      where d.announcement_id = target and d.part = 'bar') else x.closed_bar_count end,
    counted_at = now()
  where x.id = target;
end;
$$;

-- Admin → Announcements' "Count again" (super admin only).
create function public.recount_announcement(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.announcements where id = target) then
    raise exception 'This announcement was deleted.' using errcode = 'P0002';
  end if;
  perform public.count_announcement(target);
end;
$$;

-- `a` has the column names as keys; no id (or null) = a new one. updated_at takes the clock's time (not the
-- transaction's), so announcements_key changes with every save. Counts the announcement after saving.
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
      name, is_on, starts_at, ends_at, show_modal, modal_html, modal_close_after, show_bar, bar_html,
      bar_close_after, repeat, pages, genders, age_min, age_max, provinces, town_words, education_levels,
      field_words, presentations_min, presentations_max, roles, modal_size, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, r.modal_html, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max, r.provinces, r.town_words,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'), auth.uid(), now(),
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
  perform public.count_announcement(saved_id);
  perform public.log_admin_action('announcement_saved', 'announcement', saved_id::text, btrim(r.name), null);
  return saved_id;
end;
$$;

drop function public.admin_announcements();
-- Admin → Announcements: every row, newest first, with its status and its kept counts (counted_at = when).
create function public.admin_announcements()
returns table (
  id uuid, name text, is_on boolean, starts_at timestamptz, ends_at timestamptz,
  show_modal boolean, modal_html text, modal_close_after int, show_bar boolean, bar_html text, bar_close_after int,
  repeat text, pages text[], genders text[], age_min int, age_max int, provinces text[], town_words text[],
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
    a.show_modal, a.modal_html, a.modal_close_after, a.show_bar, a.bar_html, a.bar_close_after,
    a.repeat, a.pages, a.genders, a.age_min, a.age_max, a.provinces, a.town_words,
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

-- The caller closed a part. Saves the time (again on a later close). Nothing for every_visit, an unknown id, or one
-- that isn't live (so an ended one's rows, once cleaned up, don't come back).
create or replace function public.dismiss_announcement(target uuid, part text)
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
  if not exists (
    select 1 from public.announcements a
    where a.id = target and a.repeat <> 'every_visit' and public.announcement_is_live(a)
  ) then
    return;
  end if;

  insert into public.announcement_dismissals (announcement_id, user_id, part, closed_at)
  values (target, auth.uid(), dismiss_announcement.part, now())
  on conflict on constraint announcement_dismissals_pkey do update set closed_at = excluded.closed_at;
end;
$$;

-- The daily timer (src/lib/cleanupAccounts.ts). Returns how many announcements it cleaned.
create function public.cleanup_announcement_dismissals()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  cleaned int := 0;
begin
  for target in
    select id from public.announcements where ends_at <= now() - interval '30 days' and closed_cleared_at is null
  loop
    update public.announcements x set
      closed_modal_count = (select count(*) from public.announcement_dismissals d
        where d.announcement_id = target and d.part = 'modal'),
      closed_bar_count = (select count(*) from public.announcement_dismissals d
        where d.announcement_id = target and d.part = 'bar'),
      closed_cleared_at = now()
    where x.id = target;
    delete from public.announcement_dismissals where announcement_id = target;
    cleaned := cleaned + 1;
  end loop;
  return cleaned;
end;
$$;

-- The announcements already there get their numbers now.
do $$
declare
  target uuid;
begin
  for target in select id from public.announcements loop
    perform public.count_announcement(target);
  end loop;
end;
$$;

revoke execute on function public.count_announcement(uuid) from public, anon, authenticated;
revoke execute on function public.recount_announcement(uuid) from public, anon;
grant execute on function public.recount_announcement(uuid) to authenticated;
revoke execute on function public.admin_announcements() from public, anon;
grant execute on function public.admin_announcements() to authenticated;
revoke execute on function public.cleanup_announcement_dismissals() from public, anon, authenticated;
grant execute on function public.cleanup_announcement_dismissals() to service_role;
