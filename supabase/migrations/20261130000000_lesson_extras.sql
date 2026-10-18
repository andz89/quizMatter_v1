-- Follow-up to 20261129000000_lesson_week.sql: the view page gets its week list and its suggestions in ONE call.
-- Before, the page called lesson_week, and suggested_presentations called it again (twice per view), then the page
-- read the cards in a second step for each. Now lesson_extras works the week out once and returns both lists, so
-- the page reads all the cards in one go. Save counts are counted once per candidate (a grouped join), not with a
-- sub-query per row, and editor_presentations checks the profile once, not once per lesson.
-- Design: docs/superpowers/specs/2026-10-18-lesson-week-and-suggestions-design.md

-- ─── 1. Both lists in one call ────────────────────────────────────────────────────────────────────────────
-- kind 'week': the editor's lessons for that week (lesson_week's rows, with the editor's name and profile link).
-- kind 'suggestion': up to 6 live QuizMatter presentations with the same subject and a grade in common, not this one
-- and not in the week list, most saved first, then newest. `position` keeps the suggestions' order.
create function public.lesson_extras(target_id text)
returns table (id text, kind text, editor_name text, editor_slug text, "position" int)
language sql
stable
security definer
set search_path = ''
as $$
  with week as (
    select * from public.lesson_week(target_id)
  ),
  candidates as (
    select p.id, p.created_at
    from public.presentations t
    join public.presentations p
      on p.from_admin and p.is_published and p.hidden_at is null
      and p.subject = t.subject and p.grades && t.grades and p.id <> t.id
    where t.id = target_id and t.from_admin and t.is_published and t.hidden_at is null and t.subject <> ''
      and not exists (select 1 from week w where w.id = p.id)
  ),
  saves as (
    select sv.presentation_id, count(*) as total
    from public.saved_presentations sv
    join candidates c on c.id = sv.presentation_id
    group by sv.presentation_id
  ),
  suggestions as (
    select c.id, row_number() over (order by coalesce(s.total, 0) desc, c.created_at desc)::int as "position"
    from candidates c
    left join saves s on s.presentation_id = c.id
  )
  select w.id, 'week', w.editor_name, w.editor_slug, 0 from week w
  union all
  select s.id, 'suggestion', '', '', s."position" from suggestions s where s."position" <= 6;
$$;

revoke execute on function public.lesson_extras(text) from public, anon;
grant execute on function public.lesson_extras(text) to authenticated;

-- The app only calls lesson_extras now: the old pieces become internal (lesson_week is still used above).
drop function public.suggested_presentations(text);
revoke execute on function public.lesson_week(text) from authenticated;

-- ─── 2. editor_presentations: the profile checked once ────────────────────────────────────────────────────
-- Same as before (20261129000000_lesson_week.sql), but the person is looked up (and checked) first, then joined.
create or replace function public.editor_presentations(slug text)
returns table (id text)
language sql
stable
security definer
set search_path = ''
as $$
  with person as (
    select st.user_id
    from public.user_settings st
    where editor_presentations.slug <> '' and st.profile_slug = editor_presentations.slug
      and public.profile_is_visible(st.user_id)
  )
  select p.id
  from person
  join public.presentation_submissions s on s.submitter_id = person.user_id and s.status = 'approved'
  join public.presentations p on p.id = s.copy_id
  where p.from_admin and p.is_published and p.hidden_at is null
  limit 200;
$$;
