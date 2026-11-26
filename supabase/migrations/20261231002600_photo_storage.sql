-- Photo storage limit: 50 MB per teacher.
-- Spec: docs/superpowers/specs/2026-11-26-photo-storage-limit-design.md. Test: supabase/tests/photo_storage.sql.
--
-- A photo counts against a teacher while THEY UPLOADED it (a photo_uploads row) and they still use it: it's in
-- their "My photos" or on a slide of a presentation they own (their shared copy too). Each file counts once. A photo
-- someone copied never counts for the copier. Admins skip the limit. Nothing is ever deleted because of it.
--
-- Deploy: paste this into the live SQL editor BEFORE the app that calls these functions.

-- ─── The limit (PHOTO_STORAGE_LIMIT_BYTES in src/lib/photoStorage.ts: change both together) ─────────────────────
create function public.photo_storage_limit() returns bigint
language sql immutable
set search_path = ''
as $$
  select 52428800::bigint; -- 50 × 1024 × 1024
$$;

-- ─── Who uploaded which file ─────────────────────────────────────────────────────────────────────────────────
-- Kept when the photo leaves "My photos", so a photo still on a slide keeps counting. Written only by the
-- functions below and the secret key: a teacher can't delete their own records to free space.
create table public.photo_uploads (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Same limit as photoSchema.src (src/lib/schema.ts): 300 characters.
  src text not null check (src like 'https://images.quizmatter.com/uploads/%' and length(src) <= 300),
  -- Same limit as MAX_STORED_PHOTO_BYTES (src/lib/constants.ts): 2 MB. Change it here, in set_photo_upload_sizes
  -- and in the backfill below too.
  bytes integer not null check (bytes > 0 and bytes <= 2097152),
  -- false = estimated (the backfill below); the weekly photo cleanup sends the real size.
  size_known boolean not null default true,
  -- When it was (last) uploaded: a new upload holds its space for 10 minutes while its file is stored.
  created_at timestamptz not null default now(),
  primary key (user_id, src)
);

alter table public.photo_uploads enable row level security;
revoke all on table public.photo_uploads from anon, authenticated;
grant select on table public.photo_uploads to authenticated;
grant all on table public.photo_uploads to service_role;

create policy "Own upload records" on public.photo_uploads
  for select to authenticated using (user_id = (select auth.uid()));

-- ─── How much a teacher uses ─────────────────────────────────────────────────────────────────────────────────
-- Their uploads that are in their "My photos", on their own slides, or still being uploaded (10 minutes).
create function public.photo_storage_used(target uuid) returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(u.bytes), 0)::bigint
  from public.photo_uploads u
  where u.user_id = target
    and (
      u.created_at > now() - interval '10 minutes'
      or exists (select 1 from public.photos p where p.user_id = target and p.src = u.src)
      or exists (
        select 1 from public.slide_photos sp
        join public.presentations pr on pr.id = sp.presentation_id
        where sp.src = u.src and pr.owner_id = target
      )
    );
$$;

-- ─── Does this upload fit? (upload-image asks first, before the click limit counts it; secret key) ───────────
-- True for an admin, or when the file already counts for them (uploading it again adds nothing), or when it fits.
create function public.photo_upload_fits(target uuid, target_src text, file_bytes integer) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = target)
    or exists (
      select 1 from public.photo_uploads u
      where u.user_id = target and u.src = target_src
        and (
          u.created_at > now() - interval '10 minutes'
          or exists (select 1 from public.photos p where p.user_id = target and p.src = u.src)
          or exists (
            select 1 from public.slide_photos sp
            join public.presentations pr on pr.id = sp.presentation_id
            where sp.src = u.src and pr.owner_id = target
          )
        )
    )
    or public.photo_storage_used(target) + file_bytes <= public.photo_storage_limit();
$$;

-- ─── Before an upload's file is stored (upload-image, with the secret key) ───────────────────────────────────
create function public.reserve_photo_upload(target uuid, target_src text, file_bytes integer) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- One teacher's uploads are checked one at a time, so two at once can't both slip past the limit.
  perform pg_advisory_xact_lock(hashtext('photo_storage:' || target::text));

  if not public.photo_upload_fits(target, target_src, file_bytes) then
    raise exception 'Your photo storage is full (50 MB).' using errcode = 'QMSTO';
  end if;

  insert into public.photo_uploads (user_id, src, bytes, size_known, created_at)
  values (target, target_src, file_bytes, true, now())
  on conflict (user_id, src) do update
    set bytes = excluded.bytes, size_known = true, created_at = now();
end;
$$;

-- ─── For the Photos panel's bar ──────────────────────────────────────────────────────────────────────────────
-- limit is null for an admin (no limit, no bar).
create function public.my_photo_storage() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'used', public.photo_storage_used((select auth.uid())),
    'limit', case when exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
                  then null else public.photo_storage_limit() end
  );
$$;

-- ─── Removing a photo from "My photos" ───────────────────────────────────────────────────────────────────────
-- mode 'if_unused': removes it only when none of my own slides has it (the usual click: 1 request).
--      'ask':       never removes; the editor uses it when the open presentation has it, maybe unsaved.
--      'remove':    removes it (the teacher confirmed).
-- Answers where it's still used, its size and my new total, so the panel needs no other request.
create function public.remove_my_photo(target_src text, mode text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  uses jsonb;
  removed boolean := false;
begin
  if me is null then
    raise exception 'Please log in again.' using errcode = '42501';
  end if;
  if mode is null or mode not in ('if_unused', 'ask', 'remove') then
    raise exception 'Unknown mode.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(u order by u.title, u.id), '[]'::jsonb) into uses
  from (
    select pr.id, pr.title, pr.shared_from is not null as is_shared_copy,
      jsonb_agg(s.position + 1 order by s.position) as slides
    from public.slide_photos sp
    join public.presentations pr on pr.id = sp.presentation_id
    join public.slides s on s.presentation_id = sp.presentation_id and s.id = sp.slide_id
    where sp.src = target_src and pr.owner_id = me
    group by pr.id, pr.title, pr.shared_from
  ) u;

  if mode = 'remove' or (mode = 'if_unused' and uses = '[]'::jsonb) then
    -- Through the photos table's own triggers: a photo waiting for QuizMatter is still refused (QMPHL).
    delete from public.photos p where p.user_id = me and p.src = target_src;
    removed := true;
  end if;

  return jsonb_build_object(
    'removed', removed,
    'uses', uses,
    'bytes', (select u.bytes from public.photo_uploads u where u.user_id = me and u.src = target_src),
    'used', public.photo_storage_used(me),
    'limit', case when exists (select 1 from public.admins a where a.user_id = me)
                  then null else public.photo_storage_limit() end
  );
end;
$$;

-- ─── Real sizes for the estimated rows (the weekly photo cleanup, src/lib/cleanupPhotos.ts) ───────────────────
-- One jsonb array, not a set of rows: PostgREST cuts a set at max_rows (1,000), and the rest would wait for later weeks.
create function public.photo_uploads_unknown_sizes() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct u.src), '[]'::jsonb) from public.photo_uploads u where not u.size_known;
$$;

-- sizes: { "<src>": bytes } for every estimated file: its size in R2, or 1 when it's no longer there (it takes no
-- space, and it leaves the list). Same 2 MB cap as the table (MAX_STORED_PHOTO_BYTES).
create function public.set_photo_upload_sizes(sizes jsonb) returns void
language sql security definer
set search_path = ''
as $$
  update public.photo_uploads u
  set bytes = least(greatest((s.value)::int, 1), 2097152), size_known = true
  from jsonb_each_text(sizes) s
  where u.src = s.key and not u.size_known;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.photo_storage_limit() from public, anon;
grant execute on function public.photo_storage_limit() to authenticated, service_role;

revoke all on function public.photo_storage_used(uuid) from public, anon, authenticated;
grant execute on function public.photo_storage_used(uuid) to service_role;

revoke all on function public.photo_upload_fits(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.photo_upload_fits(uuid, text, integer) to service_role;

revoke all on function public.reserve_photo_upload(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_photo_upload(uuid, text, integer) to service_role;

revoke all on function public.my_photo_storage() from public, anon;
grant execute on function public.my_photo_storage() to authenticated, service_role;

revoke all on function public.remove_my_photo(text, text) from public, anon;
grant execute on function public.remove_my_photo(text, text) to authenticated, service_role;

revoke all on function public.photo_uploads_unknown_sizes() from public, anon, authenticated;
grant execute on function public.photo_uploads_unknown_sizes() to service_role;

revoke all on function public.set_photo_upload_sizes(jsonb) from public, anon, authenticated;
grant execute on function public.set_photo_upload_sizes(jsonb) to service_role;

-- ─── Photos already in "My photos" ───────────────────────────────────────────────────────────────────────────
-- Their size isn't saved anywhere but for shared photos, so the rest count as 2 MB (the largest a file can be)
-- until the weekly cleanup sends the real size. Their own time, so they don't count as "being uploaded".
insert into public.photo_uploads (user_id, src, bytes, size_known, created_at)
select p.user_id, p.src, coalesce(sp.bytes, 2097152), sp.bytes is not null, p.created_at
from public.photos p
left join public.shared_photos sp on sp.src = p.src
on conflict (user_id, src) do nothing;
