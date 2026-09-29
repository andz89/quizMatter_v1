-- A QuizMatter presentation is one an admin makes on Admin → Presentations, not every presentation an admin saves:
-- an admin's own presentations stay theirs. So from_admin now comes with the presentation (the app checks it with
-- zod, presentationSchema), is set once when the presentation is first saved, and never changes after that.
-- The "Only admins save admin presentations" rule still stops anyone else from setting it.

-- The last migration marked every presentation admins owned. They're their own presentations again.
update public.presentations set from_admin = false where from_admin;

-- Same as before, except from_admin: taken from the presentation on the first save, left alone after.
create or replace function public.save_presentation(presentation jsonb)
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
    from_admin, created_at, updated_at
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
    coalesce((presentation ->> 'fromAdmin')::boolean, false),
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
