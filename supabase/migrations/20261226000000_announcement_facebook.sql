-- A Facebook post or video as the announcement modal's attachment, shown with Facebook's own embedded player / post
-- box (notes: the root CLAUDE.md, "Announcements"; the app's side: src/lib/facebook.ts). Only the link is saved:
-- {kind: "facebook", href, video}. The frame's address is built by the app from the checked link.
-- - announcement_attachment_ok also takes the facebook kind: href is https on facebook.com (www., m., web.) or
--   fb.watch, at most 500 characters, no spaces, quotes or < >; video is true or false; no other keys.
-- - used_photo_srcs keeps only attachments that have a picture (a Facebook one has none).
-- - A missing key is now refused too (it gave "unknown", which a check lets through).
-- Test: supabase/tests/announcement_facebook.sql.

-- A photo's or a YouTube card's picture: src is our R2 address (the same as PHOTO_URL_PREFIX in
-- src/lib/constants.ts); sizes, when there, are whole numbers 1–1920. (Was part of announcement_attachment_ok in
-- 20261225000000_announcement_post.sql.)
create function public.announcement_picture_ok(a jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(a -> 'src') = 'string'
    and starts_with(a ->> 'src', 'https://images.quizmatter.com/uploads/')
    and char_length(a ->> 'src') <= 300
    and a ->> 'src' !~ '[\s"''<>]'
    and (not a ? 'width' or (jsonb_typeof(a -> 'width') = 'number'
      and (a ->> 'width')::numeric between 1 and 1920 and (a ->> 'width')::numeric % 1 = 0))
    and (not a ? 'height' or (jsonb_typeof(a -> 'height') = 'number'
      and (a ->> 'height')::numeric between 1 and 1920 and (a ->> 'height')::numeric % 1 = 0)), false);
$$;

-- Same rules as modalAttachmentSchema in src/lib/announcements.ts. coalesce(…, false): a missing key gives "unknown"
-- (null) in SQL, and a check lets "unknown" through, so it's turned into "no" (the 20261225 version let a YouTube
-- card without a title through this way).
create or replace function public.announcement_attachment_ok(a jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a is null or coalesce(
    jsonb_typeof(a) = 'object'
    and case a ->> 'kind'
      when 'facebook' then
        (select array_agg(k) from jsonb_object_keys(a) k) <@ array['kind', 'href', 'video']
        and jsonb_typeof(a -> 'href') = 'string'
        and char_length(a ->> 'href') <= 500
        and a ->> 'href' ~ '^https://(((www|m|web)\.)?facebook\.com|fb\.watch)/[^\s"''<>]+$'
        and jsonb_typeof(a -> 'video') = 'boolean'
      when 'photo' then
        (select array_agg(k) from jsonb_object_keys(a) k) <@ array['kind', 'src', 'width', 'height']
        and public.announcement_picture_ok(a)
      when 'youtube' then
        (select array_agg(k) from jsonb_object_keys(a) k) <@ array['kind', 'video_id', 'title', 'src', 'width', 'height']
        and public.announcement_picture_ok(a)
        and jsonb_typeof(a -> 'video_id') = 'string' and a ->> 'video_id' ~ '^[A-Za-z0-9_-]{11}$'
        and jsonb_typeof(a -> 'title') = 'string' and char_length(a ->> 'title') <= 200
      else false
    end,
    false
  );
$$;

-- Same as 20261225000000_announcement_post.sql, but only attachments that have a picture.
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
    select a.modal_attachment ->> 'src' from public.announcements a where a.modal_attachment ? 'src'
  ) as used (src);
$$;

revoke execute on function public.announcement_picture_ok(jsonb) from public, anon, authenticated;
