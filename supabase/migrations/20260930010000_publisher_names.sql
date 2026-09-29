-- The display names of the people who published presentations, so other teachers see "Published by Ms. Cruz".
-- user_settings only lets each user read their own row, so this function reads past that rule, but it only
-- gives back the display name (never the email or other settings), and only of users with at least one
-- published presentation. Users without a display name are left out.

create function public.publisher_names(owner_ids uuid[])
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.display_name
  from public.user_settings s
  where s.user_id = any (owner_ids)
    and s.display_name <> ''
    and exists (select 1 from public.presentations p where p.owner_id = s.user_id and p.is_published);
$$;

revoke execute on function public.publisher_names(uuid[]) from public, anon;
grant execute on function public.publisher_names(uuid[]) to authenticated;
