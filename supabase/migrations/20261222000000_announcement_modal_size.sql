-- The announcement modal's size: the super admin picks Small (300 wide), Medium (500 wide) or Large (672 wide, the
-- normal modal) for each announcement; the height always fits the text (MODAL_SIZES in src/lib/announcements.ts).
-- Notes: the root CLAUDE.md, "Announcements".
-- - announcements.modal_size, 'large' for the ones made before (their size until now).
-- - save_announcement saves it; a save without it (an app tab from before) counts as 'large'.
-- - admin_announcements and my_announcements return it. What they return changes, so they're made again (with
--   their grants).
-- Test: supabase/tests/announcement_modal_size.sql.

alter table public.announcements
  add column modal_size text not null default 'large' check (modal_size in ('small', 'medium', 'large'));

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
      modal_size = coalesce(r.modal_size, 'large'), updated_at = clock_timestamp()
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
-- Admin → Announcements: every row, newest first, with its status, how many accounts match now, and how many
-- closed each part.
create function public.admin_announcements()
returns table (
  id uuid, name text, is_on boolean, starts_at timestamptz, ends_at timestamptz,
  show_modal boolean, modal_html text, modal_close_after int, show_bar boolean, bar_html text, bar_close_after int,
  repeat text, pages text[], genders text[], age_min int, age_max int, provinces text[], town_words text[],
  education_levels text[], field_words text[], presentations_min int, presentations_max int, roles text[],
  created_by uuid, created_at timestamptz, updated_at timestamptz, modal_size text,
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
    a.created_by, a.created_at, a.updated_at, a.modal_size,
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

drop function public.my_announcements();
-- The caller's live, matching announcements, newest first. A part they closed comes back off (with no text): once
-- = they closed it at all, daily = they closed it today (Philippine date). Rows with both parts off are left out.
-- Never the targets or the name. Logged out or banned: none.
create function public.my_announcements()
returns table (
  id uuid, show_modal boolean, modal_html text, modal_close_after int, show_bar boolean, bar_html text,
  bar_close_after int, repeat text, pages text[], created_at timestamptz, modal_size text
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
    m.repeat, m.pages, m.created_at, m.modal_size
  from mine m
  where m.modal_open or m.bar_open
  order by m.created_at desc, m.id;
$$;

revoke execute on function public.admin_announcements() from public, anon;
grant execute on function public.admin_announcements() to authenticated;
revoke execute on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated;
