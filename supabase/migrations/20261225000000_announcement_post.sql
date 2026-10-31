-- The announcement modal as a post (docs/superpowers/specs/2026-10-31-announcement-post-design.md; notes: the root
-- CLAUDE.md, "Announcements"): plain text with padding, then at most one attachment that fills the modal's width.
-- - announcements.modal_text (plain text, at most 5,000 characters) and modal_attachment (null, or a picture
--   {kind: "photo", src, width?, height?}, or a YouTube card {kind: "youtube", video_id, title, src, width?,
--   height?}, checked by announcement_attachment_ok: src is always our own R2 copy). They replace modal_html.
-- - Existing announcements are converted first (announcement_text_from_html, announcement_attachment_from_html).
-- - Newest save_announcement, admin_announcements, my_announcements and used_photo_srcs (it keeps the attachment's
--   picture: a photo or a YouTube thumbnail).
-- Test: supabase/tests/announcement_post.sql.

-- ─── 1. The checks ────────────────────────────────────────────────────────────────────────────────────────────
-- A modal's attachment: null, a photo or a YouTube card, with only these keys. src is our R2 address (the same as
-- PHOTO_URL_PREFIX in src/lib/constants.ts); sizes are whole numbers 1–1920; a video id is 11 letters, digits,
-- "-" or "_"; a title at most 200 characters. Same rules as modalAttachmentSchema in src/lib/announcements.ts.
create function public.announcement_attachment_ok(a jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a is null or (
    jsonb_typeof(a) = 'object'
    and jsonb_typeof(a -> 'src') = 'string'
    and starts_with(a ->> 'src', 'https://images.quizmatter.com/uploads/')
    and char_length(a ->> 'src') <= 300
    and a ->> 'src' !~ '[\s"''<>]'
    and (not a ? 'width' or (jsonb_typeof(a -> 'width') = 'number'
      and (a ->> 'width')::numeric between 1 and 1920 and (a ->> 'width')::numeric % 1 = 0))
    and (not a ? 'height' or (jsonb_typeof(a -> 'height') = 'number'
      and (a ->> 'height')::numeric between 1 and 1920 and (a ->> 'height')::numeric % 1 = 0))
    and case a ->> 'kind'
      when 'photo' then
        (select array_agg(k) from jsonb_object_keys(a) k) <@ array['kind', 'src', 'width', 'height']
      when 'youtube' then
        (select array_agg(k) from jsonb_object_keys(a) k) <@ array['kind', 'video_id', 'title', 'src', 'width', 'height']
        and jsonb_typeof(a -> 'video_id') = 'string' and a ->> 'video_id' ~ '^[A-Za-z0-9_-]{11}$'
        and jsonb_typeof(a -> 'title') = 'string' and char_length(a ->> 'title') <= 200
      else false
    end
  );
$$;

-- ─── 2. Old rich text → a post (used once below; kept so the test can check it) ───────────────────────────────
-- The text: line breaks and paragraphs become new lines, tags go, the usual entities are decoded.
create function public.announcement_text_from_html(html text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    replace(replace(replace(replace(replace(replace(
      regexp_replace(
        regexp_replace(regexp_replace(coalesce(html, ''), '<br\s*/?>', E'\n', 'gi'), '</p>', E'\n', 'gi'),
        '<[^>]*>', '', 'g'),
      '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&nbsp;', ' '), '&amp;', '&'),
    E'\n ');
$$;

-- The first of our own pictures in it (with its width and height when they're there), or null.
create function public.announcement_attachment_from_html(html text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  tag text;
  src text;
  width int;
  height int;
begin
  for tag in select m[1] from regexp_matches(coalesce(html, ''), '(<img[^>]*>)', 'gi') as m loop
    src := substring(tag from 'src="([^"]+)"');
    if starts_with(src, 'https://images.quizmatter.com/uploads/') and char_length(src) <= 300 then
      width := substring(tag from 'width="([0-9]{1,4})"')::int;
      height := substring(tag from 'height="([0-9]{1,4})"')::int;
      return jsonb_strip_nulls(jsonb_build_object(
        'kind', 'photo', 'src', src,
        'width', case when width between 1 and 1920 then width end,
        'height', case when height between 1 and 1920 then height end
      ));
    end if;
  end loop;
  return null;
end;
$$;

-- ─── 3. The new columns, the existing announcements converted, modal_html gone ───────────────────────────────
alter table public.announcements
  add column modal_text text not null default '' check (char_length(modal_text) <= 5000),
  add column modal_attachment jsonb check (public.announcement_attachment_ok(modal_attachment));

update public.announcements set
  modal_text = left(public.announcement_text_from_html(modal_html), 5000),
  modal_attachment = public.announcement_attachment_from_html(modal_html);
-- A shown modal left with nothing (its only picture was from another site): its name, so it still says something.
update public.announcements set modal_text = name
where show_modal and btrim(modal_text) = '' and modal_attachment is null;

-- Its checks (the length, and "a shown modal has text") go with it.
alter table public.announcements drop column modal_html;
alter table public.announcements add constraint announcements_modal_has_content
  check (not show_modal or btrim(modal_text) <> '' or modal_attachment is not null);

-- ─── 4. Saving and reading them ───────────────────────────────────────────────────────────────────────────────
-- `a` has the column names as keys; no id (or null) = a new one. updated_at takes the clock's time (not the
-- transaction's), so announcements_key changes with every save. The app counts it next (recount_announcement).
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
      bar_close_after, repeat, pages, genders, age_min, age_max, provinces, town_words, education_levels,
      field_words, presentations_min, presentations_max, roles, modal_size, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, coalesce(r.modal_text, ''), r.modal_attachment, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max, r.provinces, r.town_words,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'), auth.uid(), now(),
      clock_timestamp()
    )
    returning id into saved_id;
  else
    update public.announcements x set
      name = btrim(r.name), is_on = r.is_on, starts_at = r.starts_at, ends_at = r.ends_at,
      show_modal = r.show_modal, modal_text = coalesce(r.modal_text, ''), modal_attachment = r.modal_attachment, modal_close_after = r.modal_close_after,
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
  perform public.log_admin_action('announcement_saved', 'announcement', saved_id::text, btrim(r.name), null);
  return saved_id;
end;
$$;

drop function public.admin_announcements();
-- Admin → Announcements: every row, newest first, with its status and its kept counts (counted_at = when).
create function public.admin_announcements()
returns table (
  id uuid, name text, is_on boolean, starts_at timestamptz, ends_at timestamptz,
  show_modal boolean, modal_text text, modal_attachment jsonb, modal_close_after int, show_bar boolean, bar_html text, bar_close_after int,
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
    a.show_modal, a.modal_text, a.modal_attachment, a.modal_close_after, a.show_bar, a.bar_html, a.bar_close_after,
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

drop function public.my_announcements();
-- The caller's live, matching announcements, newest first. A part they closed comes back off (with no text): once
-- = they closed it at all, daily = they closed it today (Philippine date). Rows with both parts off are left out.
-- Never the targets or the name. Logged out or banned: none.
create function public.my_announcements()
returns table (
  id uuid, show_modal boolean, modal_text text, modal_attachment jsonb, modal_close_after int, show_bar boolean, bar_html text,
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
    m.id, m.modal_open, case when m.modal_open then m.modal_text else '' end, case when m.modal_open then m.modal_attachment end, m.modal_close_after,
    m.bar_open, case when m.bar_open then m.bar_html else '' end, m.bar_close_after,
    m.repeat, m.pages, m.created_at, m.modal_size
  from mine m
  where m.modal_open or m.bar_open
  order by m.created_at desc, m.id;
$$;

-- ─── 5. Photo cleanup: an attachment's picture counts as used ────────────────────────────────────────────────
-- Same as 20261221000000_announcements.sql, with the modal's attachment (a photo or a YouTube thumbnail) instead of
-- the <img> tags of modal_html.
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
    select a.modal_attachment ->> 'src' from public.announcements a where a.modal_attachment is not null
  ) as used (src);
$$;

revoke execute on function public.announcement_attachment_ok(jsonb) from public, anon, authenticated;
revoke execute on function public.announcement_text_from_html(text) from public, anon, authenticated;
revoke execute on function public.announcement_attachment_from_html(text) from public, anon, authenticated;
revoke execute on function public.admin_announcements() from public, anon;
grant execute on function public.admin_announcements() to authenticated;
revoke execute on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated;
