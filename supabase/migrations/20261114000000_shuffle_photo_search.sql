-- Photos that match a search equally well come back in a random order each time, instead of newest
-- first, so Claude (find_photos) doesn't pick the same kid for every presentation. Better matches still
-- come first, and an empty search still shows the newest photos. Volatile now, since it uses random().
create or replace function public.search_shared_photos(query text)
returns table (src text, width integer, height integer, file_name text, category text, description text, tags text[], source text)
language sql
volatile
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
  order by m.hits desc, case when trim(query) = '' then sp.created_at end desc nulls last, random()
  limit 20;
$$;
