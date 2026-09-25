-- Reference links about a lesson (sources, the curriculum guide…), as many as the user adds.
-- Named reference_links because "references" is a reserved word in SQL.

alter table public.quizzes add column reference_links text[] not null default '{}';

-- Same as before, plus reference_links. The app checks each link with zod (full http/https links) first.
create or replace function public.save_quiz(quiz jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := quiz ->> 'id';
begin
  insert into public.quizzes (
    id, title, description, grade, subject, curriculum, learning_competency, author, reference_links, is_published,
    created_at, updated_at
  )
  values (
    target_id,
    quiz ->> 'title',
    quiz ->> 'description',
    quiz ->> 'grade',
    quiz ->> 'subject',
    quiz ->> 'curriculum',
    quiz ->> 'learningCompetency',
    quiz ->> 'author',
    array(select jsonb_array_elements_text(quiz -> 'referenceLinks')),
    (quiz ->> 'isPublished')::boolean,
    to_timestamp((quiz ->> 'createdAt')::bigint / 1000.0),
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
  where s.quiz_id = target_id
    and s.id not in (select slide ->> 'id' from jsonb_array_elements(quiz -> 'slides') as slide);

  insert into public.slides (quiz_id, id, position, data)
  select target_id, slide ->> 'id', (ord - 1)::int, slide
  from jsonb_array_elements(quiz -> 'slides') with ordinality as t(slide, ord)
  on conflict (quiz_id, id) do update set position = excluded.position, data = excluded.data;
end;
$$;
