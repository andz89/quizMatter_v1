-- Lesson details (all optional, '' when not filled in) and private/published. The owner (owner_id)
-- is who published it; `author` is who wrote the content (a teacher, a book…), typed by the user.

alter table public.quizzes
  add column description text not null default '',
  add column grade text not null default '',
  add column subject text not null default '',
  add column curriculum text not null default '',
  add column learning_competency text not null default '',
  add column author text not null default '',
  add column is_published boolean not null default false;

-- Same as before, plus the new columns. The app checks the quiz with zod (quizSchema) before calling this.
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
    id, title, description, grade, subject, curriculum, learning_competency, author, is_published, created_at, updated_at
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
