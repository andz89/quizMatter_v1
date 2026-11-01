-- HTML top bar in a sealed box (spec docs/superpowers/specs/2026-11-01-announcement-html-design.md, "Top bar").
--
-- Like the HTML modal (20261230000000_announcement_html.sql), a top bar is now text (the editor's cleaned HTML, as
-- before) or the super admin's own HTML, run by the app only in the sealed box. The HTML goes in bar_html itself:
-- up to 1,000 characters for text, 50,000 for html. Also its height, the functions that read and write the two new
-- fields, and the photo rules (a photo whose address is in an html bar counts as used).

alter table public.announcements
  add column bar_format text not null default 'text' check (bar_format in ('text', 'html')),
  -- Same limits as ANNOUNCEMENT_LIMITS (src/lib/announcements.ts).
  add column bar_height int not null default 60 check (bar_height between 30 and 300);

alter table public.announcements drop constraint announcements_bar_html_check;
alter table public.announcements add constraint announcements_bar_html_check
  check (char_length(bar_html) <= case when bar_format = 'html' then 50000 else 1000 end);

-- Newest save_announcement: also bar_format and bar_height (a save without them, from an older app tab, is text).
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
      bar_format, bar_height, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, coalesce(r.modal_text, ''), r.modal_attachment, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'),
      coalesce(r.modal_format, 'post'), coalesce(r.modal_html, ''), coalesce(r.modal_height, 400),
      coalesce(r.bar_format, 'text'), coalesce(r.bar_height, 60),
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

-- Newest admin_announcements: also bar_format and bar_height (dropped first: its columns change).
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

-- Newest my_announcements: also bar_format and bar_height.
drop function public.my_announcements();
create function public.my_announcements()
returns table (
  id uuid, show_modal boolean, modal_text text, modal_attachment jsonb, modal_close_after int,
  show_bar boolean, bar_html text, bar_close_after int, repeat text, pages text[], created_at timestamptz,
  modal_size text, modal_format text, modal_html text, modal_height int, bar_format text, bar_height int
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
    m.bar_format, m.bar_height
  from mine m
  where m.modal_open or m.bar_open
  order by m.created_at desc, m.id;
$$;

revoke execute on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated, service_role;

-- Newest announcement_uses_photo: also an html bar that holds the address.
create or replace function public.announcement_uses_photo(a public.announcements, photo_src text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (a.modal_attachment ->> 'kind' = 'photo' and a.modal_attachment ->> 'src' = photo_src)
    or (a.modal_format = 'html' and strpos(a.modal_html, photo_src) > 0)
    or (a.bar_format = 'html' and strpos(a.bar_html, photo_src) > 0);
$$;

-- Newest used_photo_srcs: also every one of our addresses written in an html bar.
create or replace function public.used_photo_srcs()
returns text[]
language sql
stable
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
    select a.modal_attachment ->> 'src' from public.announcements a where a.modal_attachment ? 'src'
    union
    select ap.src from public.announcement_photos ap
    union
    select (regexp_matches(a.modal_html, 'https://images\.quizmatter\.com/uploads/[A-Za-z0-9._-]+', 'g'))[1]
    from public.announcements a where a.modal_format = 'html'
    union
    select (regexp_matches(a.bar_html, 'https://images\.quizmatter\.com/uploads/[A-Za-z0-9._-]+', 'g'))[1]
    from public.announcements a where a.bar_format = 'html'
  ) as used (src);
$$;
