-- Announcement columns: fewer copies, nothing forgotten (spec
-- docs/superpowers/specs/2026-11-02-announcement-columns-design.md, test supabase/tests/announcement_columns.sql).
--
-- admin_announcements now returns the table's own rows, so a new column reaches the admin pages by itself (the app
-- works out the status label: announcementStatus in src/lib/announcements.ts). save_announcement keeps its written
-- list (what the admin may set), but an update starts from the row as it is, so a key the app didn't send (an older
-- tab) keeps its value instead of going back to the default. my_announcements keeps its own list (what teachers may
-- see). The test fails when a new column is missing from the save, or is neither sent to teachers nor marked admin
-- only.
--
-- Deploy: the app first, then this (the old app reads admin_announcements' status, which is gone).

-- Newest save_announcement: an update starts from the current row (jsonb_populate_record(cur, a)).
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
      modal_display = r.modal_display, modal_auto_close = r.modal_auto_close,
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

-- Newest admin_announcements: the table's own rows, newest first (dropped first: its columns change).
drop function public.admin_announcements();
create function public.admin_announcements()
returns setof public.announcements
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  return query select a.* from public.announcements a order by a.created_at desc, a.id;
end;
$$;

revoke execute on function public.admin_announcements() from public, anon;
grant execute on function public.admin_announcements() to authenticated, service_role;
