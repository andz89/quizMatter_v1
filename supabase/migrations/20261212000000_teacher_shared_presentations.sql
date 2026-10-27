-- A teacher's profile page (/teachers/<link name>) also lists the presentations they published: their shared copies
-- (see 20261123000000_shared_copy.sql), as other teachers see them on the "Other teachers" tab. The page knows only
-- the link name, and user_settings is readable only by its owner, so this function finds the person (with the same
-- visibility check as teacher_profile: a hidden admin's profile gives nothing) and hands out just the copies' ids.
-- Editors can't publish, so their profile gets none here (their QuizMatter lessons come from editor_presentations).

create function public.teacher_shared_presentations(slug text)
returns table (id text)
language sql
stable
security definer
set search_path = ''
as $$
  with person as (
    select st.user_id
    from public.user_settings st
    where teacher_shared_presentations.slug <> '' and st.profile_slug = teacher_shared_presentations.slug
      and public.profile_is_visible(st.user_id)
  )
  select p.id
  from person
  join public.presentations p on p.owner_id = person.user_id
  where p.shared_from is not null and p.is_published and p.hidden_at is null and not p.from_admin
  order by p.updated_at desc
  limit 200;
$$;

revoke execute on function public.teacher_shared_presentations(text) from public, anon;
grant execute on function public.teacher_shared_presentations(text) to authenticated;
