-- Photos Claude adds to the shared library (/api/claude-photo) wait for an admin's review: teachers (and Claude's
-- find_photos) only get approved photos, and Admin → Photos lists the waiting ones with Approve buttons.
-- Every photo already shared, and every photo an admin uploads, is approved.

alter table public.shared_photos add column approved boolean not null default true;

-- Teachers read only approved photos. Admins still read every photo through "Admins change shared photos"
-- (it's "for all", which includes reading).
drop policy "Everyone reads shared photos" on public.shared_photos;
create policy "Everyone reads approved shared photos" on public.shared_photos
  for select to authenticated using (approved);

-- The same views as in 20261004000000_shared_photos_search.sql, with `approved` (for the admin page's filter)
-- and a count of the waiting photos added at the end (a view can only get new columns at the end).
create or replace view public.shared_photos_search with (security_invoker = true) as
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
    c.name as category_name,
    sp.approved
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id;

create or replace view public.shared_photo_counts with (security_invoker = true) as
  select
    category_id,
    count(*)::integer as photos,
    (count(*) filter (where description = ''))::integer as no_description,
    (count(*) filter (where source = ''))::integer as no_source,
    (count(*) filter (where not approved))::integer as waiting
  from public.shared_photos
  group by category_id;

-- The same search as in 20260929030000_shared_photo_source.sql, now only over approved photos. It runs with the
-- secret key (which skips the rules above), so it has to leave the waiting ones out itself.
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
  where sp.approved and (m.hits > 0 or trim(query) = '')
  order by m.hits desc, sp.created_at desc
  limit 20;
$$;
