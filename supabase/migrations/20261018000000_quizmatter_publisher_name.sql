-- Who published a presentation: "Display Name (email)", or just the email when they have no display name.
-- Presentations an admin owns show "QuizMatter" to teachers; only admins see which admin it was.
-- Same as before: only owners with at least one published presentation.

create or replace function public.publisher_names(owner_ids uuid[])
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select names.user_id, names.display_name
  from (
    select o.id as user_id,
      case
        when a.user_id is not null and not (select public.is_admin()) then 'QuizMatter'
        when coalesce(s.display_name, '') = '' then coalesce(u.email, '')
        else s.display_name || coalesce(' (' || u.email || ')', '')
      end as display_name
    from unnest(owner_ids) as o (id)
    left join public.admins a on a.user_id = o.id
    left join public.user_settings s on s.user_id = o.id
    left join auth.users u on u.id = o.id
  ) names
  where names.display_name <> ''
    and exists (select 1 from public.presentations p where p.owner_id = names.user_id and p.is_published);
$$;
