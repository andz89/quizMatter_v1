-- The shared photos as Admin → Photos searches them (src/app/admin/page.tsx). The database can't do a
-- "contains this text" search on a list, so the tags are also joined into one line (tags_text, e.g.
-- "frog amphibian rainforest"), and the category's name comes along so it can be searched too.
-- security_invoker: whoever asks gets only the rows the shared_photos rules already let them see.

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

-- How many shared photos each category has, and how many of them have no description or no source, for the
-- page's filter buttons (one short row per category, instead of loading every photo to count them).
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
