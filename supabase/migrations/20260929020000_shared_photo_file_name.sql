-- A name for each shared photo: its file name when it was uploaded (e.g. "red-eyed-tree-frog.jpg"), which
-- admins can change. Teachers (the editor's Photos search) and Claude (find_photos) search it.
-- It's only a name to show and search: the stored file keeps its fingerprint name, so renaming never
-- breaks a slide. The limit is checked with zod first (sharedPhotoInfoSchema in src/lib/schema.ts).

alter table public.shared_photos
  add column file_name text not null default '' check (length(file_name) <= 200);

-- The same search as before (see 20260929010000_shared_photo_info.sql), now also in the file name, which
-- it returns too. Dropped first: a function's result columns can't be changed in place.
drop function public.search_shared_photos(text);

create function public.search_shared_photos(query text)
returns table (src text, width integer, height integer, file_name text, category text, description text, tags text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select sp.src, sp.width, sp.height, sp.file_name, c.name, sp.description, sp.tags
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id
  cross join lateral (
    -- Split into words (letters and digits only, so % and _ can't act as wildcards).
    select count(*) as hits
    from unnest(regexp_split_to_array(lower(query), '[^[:alnum:]]+')) as w (word)
    where w.word <> ''
      and (
        lower(sp.description) like '%' || w.word || '%'
        or lower(sp.file_name) like '%' || w.word || '%'
        or lower(c.name) like '%' || w.word || '%'
        or exists (select 1 from unnest(sp.tags) as t (tag) where lower(t.tag) like '%' || w.word || '%')
      )
  ) as m
  where m.hits > 0 or trim(query) = ''
  order by m.hits desc, sp.created_at desc
  limit 20;
$$;

revoke execute on function public.search_shared_photos(text) from public, anon, authenticated;
grant execute on function public.search_shared_photos(text) to service_role;
