-- Teacher profiles (docs/superpowers/specs/2026-10-09-teacher-profiles-design.md): a short bio, and a profile page
-- (/teachers/<id>) that any logged-in user can open with the link. The limit is checked with zod first
-- (profileSchema in src/lib/userSettings.ts).

alter table public.user_settings
  add column bio text not null default '' check (char_length(bio) <= 300);

-- The one rule for whose profile the caller may see: any account except an admin's, which only that admin and other
-- admins see (teachers know admins only as "QuizMatter"). Used by the two functions below; not callable on its own.
create function public.profile_is_visible(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = profile_id)
    and (
      not exists (select 1 from public.admins a where a.user_id = profile_id)
      or profile_id = (select auth.uid())
      or (select public.is_admin())
    );
$$;

revoke execute on function public.profile_is_visible(uuid) from anon, authenticated, public;

-- The public part of a teacher's settings, for their profile page. user_settings itself stays readable only by its
-- owner (it also holds the contact number), so this function hands out just these fields, never the contact number
-- or email. No row = no such account, or a hidden admin.
create function public.teacher_profile(profile_id uuid)
returns table (
  display_name text,
  first_name text,
  last_name text,
  education_level text,
  education_field text,
  bio text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(s.display_name, ''),
    coalesce(s.first_name, ''),
    coalesce(s.last_name, ''),
    coalesce(s.education_level, ''),
    coalesce(s.education_field, ''),
    coalesce(s.bio, '')
  from auth.users u
  left join public.user_settings s on s.user_id = u.id
  where u.id = profile_id and public.profile_is_visible(u.id);
$$;

revoke execute on function public.teacher_profile(uuid) from anon, public;
grant execute on function public.teacher_profile(uuid) to authenticated;

-- Which of these accounts have a profile the caller may open: the presentation page links only those names, so a
-- teacher never gets a link to a hidden admin.
create function public.visible_profiles(profile_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from unnest(profile_ids) as ids (id) where public.profile_is_visible(id);
$$;

revoke execute on function public.visible_profiles(uuid[]) from anon, public;
grant execute on function public.visible_profiles(uuid[]) to authenticated;
