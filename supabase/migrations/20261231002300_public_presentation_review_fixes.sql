-- Review fixes for the public preview (20261231002200_public_presentation.sql; spec
-- docs/superpowers/specs/2026-11-20-public-presentation-preview-design.md, "Review fixes").
-- 1. No display name: a teacher's display name is usually their full name (sign up makes it from their names), so
--    the open web gets only the Author text they typed, or "QuizMatter" for a QuizMatter lesson; else nothing.
-- 2. No answers: anyone can call this with the public key, so the first slide comes back without its answer
--    (correctOptionId emptied, correctAnswer left out, and the pictures in the answer box, containerId "answer",
--    the app's ANSWER_CONTAINER_ID, left out).

create or replace function public.public_presentation(p_id text)
returns table (
  title text,
  description text,
  subject text,
  grades text[],
  from_admin boolean,
  author_name text,
  slide_count int,
  first_slide jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.title,
    p.description,
    p.subject,
    p.grades,
    p.from_admin,
    coalesce(
      nullif(btrim(p.author), ''),
      case when p.from_admin or exists (select 1 from public.admins a where a.user_id = p.owner_id) then 'QuizMatter' end,
      ''
    ),
    -- Shown slides, like shownSlides in src/lib/constants.ts: the ones not hidden, or all of them when every one is.
    shown.total,
    case when shown.first is not null then
      jsonb_set(shown.first - 'correctAnswer', '{correctOptionId}', 'null'::jsonb)
        || jsonb_build_object('elements', coalesce((
          select jsonb_agg(e order by n)
          from jsonb_array_elements(coalesce(shown.first -> 'elements', '[]'::jsonb)) with ordinality as x (e, n)
          where e ->> 'containerId' is distinct from 'answer'
        ), '[]'::jsonb))
    end
  from public.presentations p
  cross join lateral (
    select count(*)::int as total,
      (array_agg(s.data order by s.position))[1] as first
    from public.slides s
    where s.presentation_id = p.id
      and (
        coalesce((s.data ->> 'hidden')::boolean, false) = false
        or not exists (
          select 1 from public.slides v
          where v.presentation_id = p.id and coalesce((v.data ->> 'hidden')::boolean, false) = false
        )
      )
  ) shown
  where p.id = p_id and p.is_published and p.hidden_at is null;
$$;

revoke execute on function public.public_presentation(text) from public, anon, authenticated;
grant execute on function public.public_presentation(text) to anon, authenticated;
