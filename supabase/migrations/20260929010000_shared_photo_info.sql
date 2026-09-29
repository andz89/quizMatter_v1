-- What each shared photo shows, in words, so Claude can find the right photo without seeing it (the
-- find_photos tool of the MCP server, src/pages/api/mcp.ts). Admins type them on the admin page.
-- The limits are checked with zod first (sharedPhotoInfoSchema in src/lib/schema.ts); these are a backstop.

alter table public.shared_photos
  -- One plain sentence, e.g. "A red-eyed tree frog sitting on a green leaf."
  add column description text not null default '' check (length(description) <= 300),
  -- Keywords, e.g. {frog, amphibian, rainforest}.
  add column tags text[] not null default '{}' check (cardinality(tags) <= 10);

-- Shared photos matching any word of `query` in their description, tags or category name: the ones
-- matching the most words first, then the newest. An empty query gives the newest ones.
-- Only the MCP server calls it (with the Supabase secret key); teachers read the table directly.
create function public.search_shared_photos(query text)
returns table (src text, width integer, height integer, category text, description text, tags text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select sp.src, sp.width, sp.height, c.name, sp.description, sp.tags
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id
  cross join lateral (
    -- Split into words (letters and digits only, so % and _ can't act as wildcards).
    select count(*) as hits
    from unnest(regexp_split_to_array(lower(query), '[^[:alnum:]]+')) as w (word)
    where w.word <> ''
      and (
        lower(sp.description) like '%' || w.word || '%'
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
