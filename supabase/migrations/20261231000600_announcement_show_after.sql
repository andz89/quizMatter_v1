-- Show after N seconds (test supabase/tests/announcement_show_after.sql).
--
-- A modal or corner box can wait before it shows: modal_show_after is the seconds the teacher has spent in the tab
-- (on any page; the app's AnnouncementsWatch keeps the clock), 0 = at once. A top bar always shows at once: the
-- unused-part trigger empties it there. Same limit as ANNOUNCEMENT_LIMITS.showAfterMax (src/lib/announcements.ts).
-- Added the "Adding a column" way (root CLAUDE.md, "Announcements"): the column, save_announcement, my_announcements.
--
-- Deploy: this first, then the app (the old app ignores the new column; a save from it keeps the wait, or 0 for a
-- new one).

alter table public.announcements
  add column modal_show_after int not null default 0 check (modal_show_after between 0 and 600);

-- Newest save_announcement: also modal_show_after (a new one from an older tab, without the key, shows at once).
create or replace function public.save_announcement(a jsonb, replace_current boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.announcements := jsonb_populate_record(null::public.announcements, a);
  cur public.announcements;
  saved_id uuid;
  turned_off text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  -- Same rule as announcementSchema (src/lib/announcements.ts).
  if r.show_modal and r.show_bar then
    raise exception 'Pick a modal or a top bar, not both.' using errcode = '22023';
  end if;

  if r.id is null then
    insert into public.announcements (
      name, is_on, starts_at, ends_at, show_modal, modal_text, modal_attachment, modal_close_after, show_bar, bar_html,
      bar_close_after, repeat, pages, genders, age_min, age_max, education_levels,
      field_words, presentations_min, presentations_max, roles, modal_size, modal_format, modal_html, modal_height,
      bar_format, bar_height, modal_display, modal_auto_close, modal_show_after, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, coalesce(r.modal_text, ''), r.modal_attachment, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'),
      coalesce(r.modal_format, 'post'), coalesce(r.modal_html, ''), coalesce(r.modal_height, 400),
      coalesce(r.bar_format, 'text'), coalesce(r.bar_height, 60),
      coalesce(r.modal_display, 'center'), coalesce(r.modal_auto_close, 0), coalesce(r.modal_show_after, 0),
      auth.uid(), now(), clock_timestamp()
    )
    returning id into saved_id;
  else
    select * into cur from public.announcements x where x.id = r.id for update;
    if not found then
      raise exception 'This announcement was deleted.' using errcode = 'P0002';
    end if;
    -- A key the app didn't send keeps the row's value (sent as null, it is null).
    r := jsonb_populate_record(cur, a);
    -- Again on the merged row: an update that leaves out show_bar mustn't make one that shows both.
    if r.show_modal and r.show_bar then
      raise exception 'Pick a modal or a top bar, not both.' using errcode = '22023';
    end if;
    update public.announcements x set
      name = btrim(r.name), is_on = r.is_on, starts_at = r.starts_at, ends_at = r.ends_at,
      show_modal = r.show_modal, modal_text = coalesce(r.modal_text, ''), modal_attachment = r.modal_attachment, modal_close_after = r.modal_close_after,
      show_bar = r.show_bar, bar_html = r.bar_html, bar_close_after = r.bar_close_after, repeat = r.repeat,
      pages = r.pages, genders = r.genders, age_min = r.age_min, age_max = r.age_max,
      education_levels = r.education_levels, field_words = r.field_words,
      presentations_min = r.presentations_min, presentations_max = r.presentations_max, roles = r.roles,
      modal_size = r.modal_size, modal_format = r.modal_format, modal_html = r.modal_html, modal_height = r.modal_height,
      bar_format = r.bar_format, bar_height = r.bar_height,
      modal_display = r.modal_display, modal_auto_close = r.modal_auto_close, modal_show_after = r.modal_show_after,
      updated_at = clock_timestamp(),
      -- Ending later again after its cleanup: its closed rows start over (they were deleted).
      closed_cleared_at = case when r.ends_at is null or r.ends_at > now() then null else x.closed_cleared_at end
    where x.id = cur.id
    returning x.id into saved_id;
  end if;

  if r.is_on and (r.ends_at is null or r.ends_at > now()) then
    turned_off := public.check_one_on(saved_id, replace_current);
  end if;
  perform public.log_admin_action('announcement_saved', 'announcement', saved_id::text, btrim(r.name),
    case when turned_off is null then null else jsonb_build_object('turned_off', turned_off) end);
  return saved_id;
end;
$$;

-- Newest announcement_empty_unused_part: a top bar also has no wait.
create or replace function public.announcement_empty_unused_part()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.show_modal then
    new.modal_text := '';
    new.modal_attachment := null;
    new.modal_html := '';
    new.modal_show_after := 0;
  end if;
  if not new.show_bar then
    new.bar_html := '';
  end if;
  return new;
end;
$$;

revoke execute on function public.announcement_empty_unused_part() from public, anon, authenticated;

-- Newest my_announcements: also modal_show_after (dropped first: its columns change).
drop function public.my_announcements();
create function public.my_announcements()
returns table (
  id uuid, show_modal boolean, modal_text text, modal_attachment jsonb, modal_close_after int,
  show_bar boolean, bar_html text, bar_close_after int, repeat text, pages text[], created_at timestamptz,
  modal_size text, modal_format text, modal_html text, modal_height int, bar_format text, bar_height int,
  modal_display text, modal_auto_close int, modal_show_after int
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
    m.id, m.modal_open, case when m.modal_open then m.modal_text else '' end, case when m.modal_open then m.modal_attachment end, m.modal_close_after,
    m.bar_open, case when m.bar_open then m.bar_html else '' end, m.bar_close_after,
    m.repeat, m.pages, m.created_at, m.modal_size,
    m.modal_format, case when m.modal_open then m.modal_html else '' end, m.modal_height,
    m.bar_format, m.bar_height,
    m.modal_display, m.modal_auto_close, m.modal_show_after
  from mine m
  where m.modal_open or m.bar_open
  order by m.created_at desc, m.id;
$$;

revoke execute on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated, service_role;
