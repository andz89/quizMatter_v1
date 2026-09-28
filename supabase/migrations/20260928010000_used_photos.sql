-- Every photo address still in use, for the weekly photo cleanup (src/lib/cleanupPhotos.ts): the ones on
-- any teacher's "My photos" list, and the ones inside any slide. Photo files not in this list can be
-- deleted from the R2 bucket. See docs/photo-cleanup.md.
-- Slides are searched as plain text, so a photo is found wherever it sits in the slide's JSON.
-- One array (one row) is returned, so the API's row limit can't cut the list short.

create function public.used_photo_srcs()
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
    select m[1]
    from public.slides s,
      regexp_matches(s.data::text, 'https://images\.quizmatter\.com/uploads/[0-9a-f]{64}\.(?:webp|jpg)', 'g') as m
  ) as used (src);
$$;

-- Only the cleanup job (with the Supabase secret key) may call it: it sees every teacher's photos.
revoke execute on function public.used_photo_srcs() from public, anon, authenticated;
grant execute on function public.used_photo_srcs() to service_role;
