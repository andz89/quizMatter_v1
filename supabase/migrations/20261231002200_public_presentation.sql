-- The public preview of a published presentation (docs/superpowers/specs/2026-11-20-public-presentation-preview-design.md).
-- A logged-out visitor (or a robot: Google, Facebook's link reader) who opens a published presentation's link sees its
-- title, Author, subject, grades, number of slides, description and first shown slide, plus a QuizMatter title-card
-- picture for link previews. This function is the only thing they may read: the tables stay closed to anon.
-- Published = the same rule logged-in teachers have ("Read published presentations"): is_published and not hidden.
-- Anything else gives no row, so the page sends the visitor to login exactly as before.

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
    -- The Author text; else "QuizMatter" for a QuizMatter lesson or an admin's presentation; else the owner's display
    -- name (what publisher_names gives a teacher; never an email).
    coalesce(
      nullif(btrim(p.author), ''),
      case when p.from_admin or exists (select 1 from public.admins a where a.user_id = p.owner_id) then 'QuizMatter' end,
      (select coalesce(s.display_name, '') from public.user_settings s where s.user_id = p.owner_id),
      ''
    ),
    -- Shown slides, like shownSlides in src/lib/constants.ts: the ones not hidden, or all of them when every one is.
    shown.total,
    shown.first
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
