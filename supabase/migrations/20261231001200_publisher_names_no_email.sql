-- Publisher names without the email: publisher_names gave "Display Name (email)" (or the email alone) to every
-- logged-in teacher, so one teacher account could collect every publishing teacher's email address, against the
-- Privacy Policy ("other teachers never see your email"). Now a teacher gets the display name only (a publisher
-- with no display name is left out, like before when the name was empty); admins still get "Display Name (email)"
-- or the email alone, for Admin → Reports. Admin-owned presentations still show "QuizMatter" to teachers.

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
        when not (select public.is_admin()) then coalesce(s.display_name, '')
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

revoke execute on function public.publisher_names(uuid[]) from public, anon;
grant execute on function public.publisher_names(uuid[]) to authenticated;
