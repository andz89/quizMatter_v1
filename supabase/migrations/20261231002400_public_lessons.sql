-- The public home page and the sitemap (docs/superpowers/specs/2026-11-20-public-home-and-seo-design.md).
-- public_lessons(p_limit, 1–12): the newest published, not hidden QuizMatter lessons for the public home page (logged-out
-- visitors), with their first slide. public_lesson_ids(): every such lesson's id and last change, for sitemap.xml.
-- Only QuizMatter lessons: a teacher's shared copy is public to anyone with its link, but never listed.
-- public_first_slide(p_id) is the one place the "first shown slide, without its answer" rule lives (it was inside
-- public_presentation, 20261231002300_public_presentation_review_fixes.sql), so public_presentation and
-- public_lessons can't drift apart. It isn't granted to anyone: only these functions (running as their owner) call it.
-- Review fixes (2026-11-20): the slide comes back without "hidden"; public_presentation_card is the light read (no
-- slide) for the proxy and the link picture.

create or replace function public.public_first_slide(p_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- The first slide by position among the shown ones (like shownSlides in src/lib/constants.ts: the ones not
  -- hidden, or all of them when every one is), without its answer: correctOptionId emptied, correctAnswer left out,
  -- and the pictures in the answer box (containerId "answer", the app's ANSWER_CONTAINER_ID) left out.
  -- "hidden" is dropped too: the slide is the public face, never marked "Hidden when presenting".
  select jsonb_set(f.data - 'correctAnswer' - 'hidden', '{correctOptionId}', 'null'::jsonb)
    || jsonb_build_object('elements', coalesce((
      select jsonb_agg(e order by n)
      from jsonb_array_elements(coalesce(f.data -> 'elements', '[]'::jsonb)) with ordinality as x (e, n)
      where e ->> 'containerId' is distinct from 'answer'
    ), '[]'::jsonb))
  from (
    select s.data
    from public.slides s
    where s.presentation_id = p_id
      and (
        coalesce((s.data ->> 'hidden')::boolean, false) = false
        or not exists (
          select 1 from public.slides v
          where v.presentation_id = p_id and coalesce((v.data ->> 'hidden')::boolean, false) = false
        )
      )
    order by s.position
    limit 1
  ) f;
$$;

revoke execute on function public.public_first_slide(text) from public, anon, authenticated;

-- public_presentation_card(p_id): a published, not hidden presentation's details without its slide (empty for
-- anything else). The light read for the proxy's "is it public?" check and the link picture, which never need the
-- slide (one may be 2 MB). public_presentation is this plus the first slide, so the two can't drift apart.
create or replace function public.public_presentation_card(p_id text)
returns table (
  title text,
  description text,
  subject text,
  grades text[],
  from_admin boolean,
  author_name text,
  slide_count int
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
    -- The Author text. On an editor's lesson that is the editor's display name (set by the database, on purpose:
    -- the Privacy Policy says it shows publicly); a teacher's display name never shows.
    coalesce(
      nullif(btrim(p.author), ''),
      case when p.from_admin or exists (select 1 from public.admins a where a.user_id = p.owner_id) then 'QuizMatter' end,
      ''
    ),
    (
      select count(*)::int
      from public.slides s
      where s.presentation_id = p.id
        and (
          coalesce((s.data ->> 'hidden')::boolean, false) = false
          or not exists (
            select 1 from public.slides v
            where v.presentation_id = p.id and coalesce((v.data ->> 'hidden')::boolean, false) = false
          )
        )
    )
  from public.presentations p
  where p.id = p_id and p.is_published and p.hidden_at is null;
$$;

revoke execute on function public.public_presentation_card(text) from public, anon, authenticated;
grant execute on function public.public_presentation_card(text) to anon, authenticated;

-- Same as 20261231002300_public_presentation_review_fixes.sql: the card above plus the first slide from the helper.
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
  select c.title, c.description, c.subject, c.grades, c.from_admin, c.author_name, c.slide_count,
    public.public_first_slide(p_id)
  from public.public_presentation_card(p_id) c;
$$;

revoke execute on function public.public_presentation(text) from public, anon, authenticated;
grant execute on function public.public_presentation(text) to anon, authenticated;

create or replace function public.public_lessons(p_limit int)
returns table (id text, title text, subject text, grades text[], updated_at timestamptz, first_slide jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- At most 12 (the home page shows 8): one slide may be 2 MB (slides_data_is_small_object), and anyone can call
  -- this with the public key, so one call can't pull more than about 24 MB.
  if p_limit is null or p_limit < 1 or p_limit > 12 then
    raise exception 'Ask for 1 to 12 lessons.' using errcode = '22023';
  end if;
  return query
    select p.id, p.title, p.subject, p.grades, p.updated_at, public.public_first_slide(p.id)
    from public.presentations p
    where p.from_admin and p.is_published and p.hidden_at is null
    order by p.updated_at desc, p.id
    limit p_limit;
end;
$$;

revoke execute on function public.public_lessons(int) from public, anon, authenticated;
grant execute on function public.public_lessons(int) to anon, authenticated;

create or replace function public.public_lesson_ids()
returns table (id text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.updated_at
  from public.presentations p
  where p.from_admin and p.is_published and p.hidden_at is null
  order by p.updated_at desc, p.id;
$$;

revoke execute on function public.public_lesson_ids() from public, anon, authenticated;
grant execute on function public.public_lesson_ids() to anon, authenticated;
