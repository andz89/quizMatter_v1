-- This week's lessons, editor profile lists and suggestions, on a live QuizMatter presentation's view page.
-- Design: docs/superpowers/specs/2026-10-18-lesson-week-and-suggestions-design.md
--
-- A lesson's maker is the editor whose submission made it (the approved presentation_submissions row whose copy_id
-- it is), never the Author text: two people can share a name, and the Author can say anything. Lessons an admin
-- made (no such row) have no maker here, so they get no week list, only suggestions.
-- These functions only hand out presentation ids (plus the editor's name and profile link for the week list). The
-- app then reads the cards from presentations, whose own read rules still apply. They're "security definer"
-- because teachers can't read presentation_submissions, or other people's saved_presentations rows.

-- Looking a lesson's submission up by its copy.
create index presentation_submissions_copy_idx on public.presentation_submissions (copy_id);

-- ─── 1. A live QuizMatter presentation's editor, or null ──────────────────────────────────────────────────
-- Live = shared with every teacher under QuizMatter and not hidden. Only used by the functions below.
create function public.lesson_editor(target_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.submitter_id
  from public.presentation_submissions s
  join public.presentations p on p.id = s.copy_id
  where s.copy_id = target_id and s.status = 'approved' and p.from_admin and p.is_published and p.hidden_at is null;
$$;
revoke execute on function public.lesson_editor(text) from public, anon, authenticated;

-- ─── 2. This week's lessons by the same editor ────────────────────────────────────────────────────────────
-- The lesson itself plus the same editor's live lessons with the same subject, term and week, at least one grade
-- in common, any day (every version; curriculum doesn't matter). Without a subject, term or week it's just the
-- lesson itself. Each row repeats the editor's name (display name, or the part of the email before "@", like
-- submit_review) and profile link ('' without a display name). No rows for an admin-made lesson, or when the
-- caller may not see the editor's profile (an editor who is also a hidden admin): then it's suggestions only, so a
-- teacher never sees a hidden admin's name.
create function public.lesson_week(target_id text)
returns table (id text, editor_name text, editor_slug text)
language sql
stable
security definer
set search_path = ''
as $$
  with editor as (
    select public.lesson_editor(target_id) as user_id
  ),
  target as (
    select p.* from public.presentations p, editor e
    where p.id = target_id and e.user_id is not null and public.profile_is_visible(e.user_id)
  ),
  lessons as (
    select t.id from target t
    union
    select p.id
    from target t
    join public.presentation_submissions s on s.status = 'approved' and s.submitter_id = (select user_id from editor)
    join public.presentations p on p.id = s.copy_id
    where p.from_admin and p.is_published and p.hidden_at is null
      and t.subject <> '' and t.term <> '' and t.week <> ''
      and p.subject = t.subject and p.term = t.term and p.week = t.week and p.grades && t.grades
  )
  select
    l.id,
    coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1), ''),
    coalesce(st.profile_slug, '')
  from lessons l
  cross join editor e
  join auth.users u on u.id = e.user_id
  left join public.user_settings st on st.user_id = e.user_id;
$$;

-- ─── 3. Suggestions ("You may also like") ─────────────────────────────────────────────────────────────────
-- Up to 6 live QuizMatter presentations (by editors or admins) with the same subject and at least one grade in
-- common, not this one and not one already in its week list. Most saved first (only the count is used, never who
-- saved), then newest.
create function public.suggested_presentations(target_id text)
returns table (id text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.presentations t
  join public.presentations p
    on p.from_admin and p.is_published and p.hidden_at is null
    and p.subject = t.subject and p.grades && t.grades and p.id <> t.id
  where t.id = target_id and t.from_admin and t.is_published and t.hidden_at is null and t.subject <> ''
    and p.id not in (select w.id from public.lesson_week(target_id) w)
  order by (select count(*) from public.saved_presentations sv where sv.presentation_id = p.id) desc, p.created_at desc
  limit 6;
$$;

-- ─── 4. An editor's lessons, for their profile page ───────────────────────────────────────────────────────
-- The live QuizMatter presentations made from this person's approved submissions. Nothing for a profile the caller
-- may not open (a hidden admin's). The page groups and sorts them.
create function public.editor_presentations(slug text)
returns table (id text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.user_settings st
  join public.presentation_submissions s on s.submitter_id = st.user_id and s.status = 'approved'
  join public.presentations p on p.id = s.copy_id
  where editor_presentations.slug <> '' and st.profile_slug = editor_presentations.slug
    and public.profile_is_visible(st.user_id)
    and p.from_admin and p.is_published and p.hidden_at is null
  limit 200;
$$;

-- ─── 5. Who may call them ─────────────────────────────────────────────────────────────────────────────────
revoke execute on function public.lesson_week(text) from public, anon;
revoke execute on function public.suggested_presentations(text) from public, anon;
revoke execute on function public.editor_presentations(text) from public, anon;
grant execute on function public.lesson_week(text) to authenticated;
grant execute on function public.suggested_presentations(text) to authenticated;
grant execute on function public.editor_presentations(text) to authenticated;
