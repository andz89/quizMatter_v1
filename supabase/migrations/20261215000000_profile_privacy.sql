-- A teacher chooses, for their full name, educational background and bio, whether their profile page shows it
-- (Account → Personal details, "Show on my profile"). Each starts on, so no profile changes until a teacher turns one
-- off. The owner writes them with the rest of their details (the "Own settings" policy; the settings click limit
-- counts the write). A private field never leaves the database for anyone but its owner: teacher_profile blanks it.
-- Editors' fields always show (their name is already public as the Author of their QuizMatter lessons); their saved
-- switches stay and apply again if the role is taken away.
-- Design: docs/superpowers/specs/2026-10-28-profile-privacy-design.md

alter table public.user_settings
  add column full_name_public boolean not null default true,
  add column education_public boolean not null default true,
  add column bio_public boolean not null default true;

-- A profile page: same as 20261214000000_profile_photos.sql, plus the three switches as "others see this" (the
-- saved switch, or true for an editor). A private field comes back '' unless the caller is the owner, who still sees
-- it (the page marks it "Only you can see this").
drop function public.teacher_profile(text);
create function public.teacher_profile(slug text)
returns table (
  display_name text,
  first_name text,
  last_name text,
  education_level text,
  education_field text,
  bio text,
  photo_src text,
  full_name_public boolean,
  education_public boolean,
  bio_public boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.display_name,
    case when v.full_name or v.mine then coalesce(s.first_name, '') else '' end,
    case when v.full_name or v.mine then coalesce(s.last_name, '') else '' end,
    case when v.education or v.mine then coalesce(s.education_level, '') else '' end,
    case when v.education or v.mine then coalesce(s.education_field, '') else '' end,
    case when v.bio or v.mine then coalesce(s.bio, '') else '' end,
    coalesce(pp.src, ''),
    v.full_name,
    v.education,
    v.bio
  from public.user_settings s
  left join public.profile_photos pp on pp.user_id = s.user_id
  cross join lateral (
    select
      s.full_name_public or e.is_editor as full_name,
      s.education_public or e.is_editor as education,
      s.bio_public or e.is_editor as bio,
      s.user_id = (select auth.uid()) as mine
    from (select exists (select 1 from public.editors ed where ed.user_id = s.user_id) as is_editor) e
  ) v
  where teacher_profile.slug <> ''
    and s.profile_slug = teacher_profile.slug
    and public.profile_is_visible(s.user_id);
$$;

revoke execute on function public.teacher_profile(text) from anon, public;
grant execute on function public.teacher_profile(text) to authenticated;
