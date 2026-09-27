-- Quizzes (then lessons) are called presentations now: the table, its slides' link to it, the save
-- function and the policies take the new name. Renaming keeps every row. The policies follow the
-- renamed table and column by themselves; only their names change.

alter table public.quizzes rename to presentations;
alter table public.slides rename column quiz_id to presentation_id;

alter index public.quizzes_pkey rename to presentations_pkey;
alter index public.quizzes_owner_id_idx rename to presentations_owner_id_idx;
alter index public.quizzes_published_updated_at_idx rename to presentations_published_updated_at_idx;
alter table public.presentations rename constraint quizzes_owner_id_fkey to presentations_owner_id_fkey;
alter table public.slides rename constraint slides_quiz_id_fkey to slides_presentation_id_fkey;

alter policy "Own quizzes" on public.presentations rename to "Own presentations";
alter policy "Read published quizzes" on public.presentations rename to "Read published presentations";
alter policy "Slides of own quizzes" on public.slides rename to "Slides of own presentations";
alter policy "Read slides of published quizzes" on public.slides rename to "Read slides of published presentations";

-- The blank slide's type was called "lesson".
update public.slides set data = jsonb_set(data, '{type}', '"blank"') where data ->> 'type' = 'lesson';

drop function public.save_quiz(jsonb);

-- Saves a whole presentation in one transaction: the presentation row, every slide (in order), and removes
-- slides that were deleted. The app checks the presentation with zod (presentationSchema) before calling this.
create function public.save_presentation(presentation jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := presentation ->> 'id';
begin
  insert into public.presentations (
    id, title, description, grade, subject, curriculum, learning_competency, author, reference_links, is_published,
    created_at, updated_at
  )
  values (
    target_id,
    presentation ->> 'title',
    presentation ->> 'description',
    presentation ->> 'grade',
    presentation ->> 'subject',
    presentation ->> 'curriculum',
    presentation ->> 'learningCompetency',
    presentation ->> 'author',
    array(select jsonb_array_elements_text(presentation -> 'referenceLinks')),
    (presentation ->> 'isPublished')::boolean,
    to_timestamp((presentation ->> 'createdAt')::bigint / 1000.0),
    now()
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    grade = excluded.grade,
    subject = excluded.subject,
    curriculum = excluded.curriculum,
    learning_competency = excluded.learning_competency,
    author = excluded.author,
    reference_links = excluded.reference_links,
    is_published = excluded.is_published,
    updated_at = now();

  delete from public.slides s
  where s.presentation_id = target_id
    and s.id not in (select slide ->> 'id' from jsonb_array_elements(presentation -> 'slides') as slide);

  insert into public.slides (presentation_id, id, position, data)
  select target_id, slide ->> 'id', (ord - 1)::int, slide
  from jsonb_array_elements(presentation -> 'slides') with ordinality as t(slide, ord)
  on conflict (presentation_id, id) do update set position = excluded.position, data = excluded.data;
end;
$$;

revoke execute on function public.save_presentation(jsonb) from public, anon;
grant execute on function public.save_presentation(jsonb) to authenticated;
