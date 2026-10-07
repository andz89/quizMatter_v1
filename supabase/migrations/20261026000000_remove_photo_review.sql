-- Every photo is ready at once now, including Claude's uploads: the review from 20261005000000_photo_review.sql
-- is removed. Photos still waiting simply become normal photos.

-- Teachers read every shared photo again (as in 20260928020000_shared_photos.sql).
drop policy "Everyone reads approved shared photos" on public.shared_photos;
create policy "Everyone reads shared photos" on public.shared_photos
  for select to authenticated using (true);

-- The same search, over every photo.
create or replace function public.search_shared_photos(query text)
returns table (src text, width integer, height integer, file_name text, category text, description text, tags text[], source text)
language sql
stable
security invoker
set search_path = ''
as $$
  select sp.src, sp.width, sp.height, sp.file_name, c.name, sp.description, sp.tags, sp.source
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

-- A view can't lose a column with "create or replace", so both are made again without it.
drop view public.shared_photos_search;
drop view public.shared_photo_counts;

alter table public.shared_photos drop column approved;

create view public.shared_photos_search with (security_invoker = true) as
  select
    sp.src,
    sp.width,
    sp.height,
    sp.category_id,
    sp.file_name,
    sp.description,
    sp.tags,
    sp.source,
    sp.bytes,
    sp.created_at,
    array_to_string(sp.tags, ' ') as tags_text,
    c.name as category_name
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id;

revoke all on public.shared_photos_search from public, anon;
grant select on public.shared_photos_search to authenticated;

create view public.shared_photo_counts with (security_invoker = true) as
  select
    category_id,
    count(*)::integer as photos,
    (count(*) filter (where description = ''))::integer as no_description,
    (count(*) filter (where source = ''))::integer as no_source
  from public.shared_photos
  group by category_id;

revoke all on public.shared_photo_counts from public, anon;
grant select on public.shared_photo_counts to authenticated;
