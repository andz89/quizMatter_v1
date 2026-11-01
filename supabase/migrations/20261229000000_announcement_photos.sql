-- Announcement photos: a library of the pictures uploaded for announcements (spec
-- docs/superpowers/specs/2026-11-01-announcement-photos-design.md).
--
-- Until now an announcement picture was only a file in R2, kept by the weekly cleanup while an announcement used
-- it. Now every upload is listed here (Admin → Announcements → Photos) and kept until the super admin deletes it.
-- Deleting removes only the row: the cleanup deletes the file later, and only if nothing else uses it (files are
-- named by their fingerprint, so the same file can be in a slide or the shared photos too).

create table public.announcement_photos (
  src text primary key,
  -- Empty only for photos copied below from older announcements, which may not have kept their size.
  width int,
  height int,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Same check as a modal picture (announcement_picture_ok; the app's modalAttachmentSchema).
  constraint announcement_photos_src_ok check (public.announcement_picture_ok(
    jsonb_strip_nulls(jsonb_build_object('src', src, 'width', width, 'height', height))))
);

alter table public.announcement_photos enable row level security;
revoke all on public.announcement_photos from anon, authenticated;

-- The photos the announcements use now.
insert into public.announcement_photos (src, width, height, uploaded_by, created_at)
select distinct on (a.modal_attachment ->> 'src')
  a.modal_attachment ->> 'src', (a.modal_attachment ->> 'width')::int, (a.modal_attachment ->> 'height')::int,
  a.created_by, a.created_at
from public.announcements a
where a.modal_attachment ->> 'kind' = 'photo'
order by a.modal_attachment ->> 'src', a.created_at;

-- Adds a photo the announcement-image route just stored. Already listed = nothing changes.
create function public.add_announcement_photo(photo_src text, photo_width int, photo_height int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if exists (select 1 from public.announcement_photos p where p.src = photo_src) then
    return;
  end if;
  -- One at a time, so two uploads can't both pass the limit.
  perform pg_advisory_xact_lock(hashtext('public.announcement_photos'));
  -- Same limit as ANNOUNCEMENT_PHOTOS_MAX (src/lib/announcements.ts).
  if (select count(*) from public.announcement_photos) >= 500 then
    raise exception 'At most 500 announcement photos. Delete some first.' using errcode = '22023';
  end if;
  insert into public.announcement_photos (src, width, height, uploaded_by)
  values (photo_src, photo_width, photo_height, auth.uid())
  on conflict (src) do nothing;
end;
$$;

revoke execute on function public.add_announcement_photo(text, int, int) from public, anon;
grant execute on function public.add_announcement_photo(text, int, int) to authenticated;

-- The list for the Photos tab and the form's "Choose a photo", newest first, with the announcements using each.
create function public.admin_announcement_photos()
returns table (src text, width int, height int, created_at timestamptz, used_by text[])
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
  select p.src, p.width, p.height, p.created_at,
    coalesce((
      select array_agg(a.name order by a.name) from public.announcements a
      where a.modal_attachment ->> 'kind' = 'photo' and a.modal_attachment ->> 'src' = p.src
    ), '{}')
  from public.announcement_photos p
  order by p.created_at desc, p.src;
end;
$$;

revoke execute on function public.admin_announcement_photos() from public, anon;
grant execute on function public.admin_announcement_photos() to authenticated;

-- Takes a photo off the list; refused while an announcement shows it.
create function public.delete_announcement_photo(photo_src text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  select a.name into user_name from public.announcements a
  where a.modal_attachment ->> 'kind' = 'photo' and a.modal_attachment ->> 'src' = photo_src
  order by a.name
  limit 1;
  if user_name is not null then
    raise exception '"%" uses this photo. Take it out of that announcement first.', user_name using errcode = '22023';
  end if;
  delete from public.announcement_photos p where p.src = photo_src;
end;
$$;

revoke execute on function public.delete_announcement_photo(text) from public, anon;
grant execute on function public.delete_announcement_photo(text) to authenticated;

-- Newest used_photo_srcs: also keeps every listed announcement photo.
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
  ) as used (src);
$$;
