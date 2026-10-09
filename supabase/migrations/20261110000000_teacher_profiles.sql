-- Teacher profiles (docs/superpowers/specs/2026-10-09-teacher-profiles-design.md): a short bio, and a profile page
-- (/teachers/<id>) that any logged-in user can open with the link. The limit is checked with zod first
-- (profileSchema in src/lib/userSettings.ts).

alter table public.user_settings
  add column bio text not null default '' check (char_length(bio) <= 300);

-- The public part of a teacher's settings, for their profile page. user_settings itself stays readable only by its
-- owner (it also holds the contact number), so this function hands out just these fields, never the contact number
-- or email. Teachers know admins only as "QuizMatter", so an admin's profile is shown only to that admin and other
-- admins. No row = no such account, or a hidden admin.
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
  where u.id = profile_id
    and (
      not exists (select 1 from public.admins a where a.user_id = u.id)
      or u.id = (select auth.uid())
      or (select public.is_admin())
    );
$$;

revoke execute on function public.teacher_profile(uuid) from anon, public;
grant execute on function public.teacher_profile(uuid) to authenticated;
