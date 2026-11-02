-- The corner box (spec docs/superpowers/specs/2026-11-02-announcement-corner-box-design.md, test
-- supabase/tests/announcement_corner_box.sql).
--
-- A third kind of announcement: a box at the bottom-right that doesn't block the page and can close itself. It is a
-- modal row shown in the corner (modal_display = 'corner'), so its content is the modal's (the modal_… columns, their
-- checks, photo rules and closed records, part 'modal'). modal_auto_close: seconds until it closes itself (0 = never,
-- only for a corner box). It has its own "one on at a time" slot: a centered modal, a top bar and a corner box can
-- all be on together. Same limits as ANNOUNCEMENT_LIMITS (src/lib/announcements.ts).

alter table public.announcements
  add column modal_display text not null default 'center' check (modal_display in ('center', 'corner')),
  add column modal_auto_close int not null default 0 check (modal_auto_close = 0 or modal_auto_close between 5 and 600),
  -- A corner box is Small or Medium (Large is too wide for a corner), and only a corner box closes itself.
  add constraint announcements_corner_size check (modal_display = 'center' or modal_size in ('small', 'medium')),
  add constraint announcements_auto_close_corner check (modal_display = 'corner' or modal_auto_close = 0);

-- Newest save_announcement: also modal_display and modal_auto_close (a save without them, from an older app tab, is
-- a centered modal that never closes itself).
create or replace function public.save_announcement(a jsonb, replace_current boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.announcements := jsonb_populate_record(null::public.announcements, a);
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
      bar_format, bar_height, modal_display, modal_auto_close, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, coalesce(r.modal_text, ''), r.modal_attachment, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'),
      coalesce(r.modal_format, 'post'), coalesce(r.modal_html, ''), coalesce(r.modal_height, 400),
      coalesce(r.bar_format, 'text'), coalesce(r.bar_height, 60),
      coalesce(r.modal_display, 'center'), coalesce(r.modal_auto_close, 0),
      auth.uid(), now(), clock_timestamp()
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
      modal_size = coalesce(r.modal_size, 'large'), modal_format = coalesce(r.modal_format, 'post'),
      modal_html = coalesce(r.modal_html, ''), modal_height = coalesce(r.modal_height, 400),
      bar_format = coalesce(r.bar_format, 'text'), bar_height = coalesce(r.bar_height, 60),
      modal_display = coalesce(r.modal_display, 'center'), modal_auto_close = coalesce(r.modal_auto_close, 0),
      updated_at = clock_timestamp(),
      -- Ending later again after its cleanup: its closed rows start over (they were deleted).
      closed_cleared_at = case when r.ends_at is null or r.ends_at > now() then null else x.closed_cleared_at end
    where x.id = r.id
    returning x.id into saved_id;
    if saved_id is null then
      raise exception 'This announcement was deleted.' using errcode = 'P0002';
    end if;
  end if;

  if r.is_on and (r.ends_at is null or r.ends_at > now()) then
    turned_off := public.check_one_on(saved_id, replace_current);
  end if;
  perform public.log_admin_action('announcement_saved', 'announcement', saved_id::text, btrim(r.name),
    case when turned_off is null then null else jsonb_build_object('turned_off', turned_off) end);
  return saved_id;
end;
$$;

-- Newest check_one_on: three slots (a top bar, a centered modal, a corner box), at most one of each on.
create or replace function public.check_one_on(saved uuid, replace_current boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  saved_slot text;
  other_id uuid;
  other_name text;
begin
  -- One at a time, so two tabs can't both turn one on (the lock waits for the other step to finish, then this
  -- step's next query sees what it saved).
  perform pg_advisory_xact_lock(hashtext('public.announcements'));

  select case when a.show_bar then 'bar' when a.modal_display = 'corner' then 'corner' else 'modal' end
  into saved_slot
  from public.announcements a where a.id = saved;
  select a.id, a.name into other_id, other_name
  from public.announcements a
  where a.id <> saved and a.is_on and (a.ends_at is null or a.ends_at > now())
    and (case when a.show_bar then 'bar' when a.modal_display = 'corner' then 'corner' else 'modal' end) = saved_slot
  limit 1;

  if other_id is null then
    return null;
  end if;
  if not replace_current then
    raise exception '%', other_name using errcode = 'QMONE';
  end if;
  update public.announcements set is_on = false, updated_at = clock_timestamp() where id = other_id;
  return other_name;
end;
$$;

-- Newest admin_announcements: also modal_display and modal_auto_close (dropped first: its columns change).
drop function public.admin_announcements();
create function public.admin_announcements()
returns table (
  id uuid, name text, is_on boolean, starts_at timestamptz, ends_at timestamptz,
  show_modal boolean, modal_text text, modal_attachment jsonb, modal_close_after int,
  show_bar boolean, bar_html text, bar_close_after int, repeat text, pages text[],
  genders text[], age_min int, age_max int, education_levels text[], field_words text[],
  presentations_min int, presentations_max int, roles text[],
  created_by uuid, created_at timestamptz, updated_at timestamptz, modal_size text,
  modal_format text, modal_html text, modal_height int, bar_format text, bar_height int,
  modal_display text, modal_auto_close int,
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
    a.modal_format, a.modal_html, a.modal_height, a.bar_format, a.bar_height,
    a.modal_display, a.modal_auto_close,
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
grant execute on function public.admin_announcements() to authenticated, service_role;

-- Newest my_announcements: also modal_display and modal_auto_close.
drop function public.my_announcements();
create function public.my_announcements()
returns table (
  id uuid, show_modal boolean, modal_text text, modal_attachment jsonb, modal_close_after int,
  show_bar boolean, bar_html text, bar_close_after int, repeat text, pages text[], created_at timestamptz,
  modal_size text, modal_format text, modal_html text, modal_height int, bar_format text, bar_height int,
  modal_display text, modal_auto_close int
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
    m.modal_display, m.modal_auto_close
  from mine m
  where m.modal_open or m.bar_open
  order by m.created_at desc, m.id;
$$;

revoke execute on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated, service_role;
