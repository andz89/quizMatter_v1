-- "From QuizMatter": presentations made by admins. When an admin shares one (is_published), every teacher sees
-- it in its own home-page section instead of "Published by other teachers". The admin can switch it back to a draft.

-- Set by save_presentation (never by the app), so a teacher can't mark their own presentation as from QuizMatter.
alter table public.presentations add column from_admin boolean not null default false;

-- Presentations admins already own.
update public.presentations set from_admin = true where owner_id in (select user_id from public.admins);

-- A second rule every save must also pass ("restrictive"): only an admin's save can set from_admin.
create policy "Only admins save admin presentations" on public.presentations
  as restrictive
  for all to authenticated
  using (true)
  with check (not from_admin or (select public.is_admin()));

-- The home page lists them newest first (changed or created).
create index presentations_from_admin_updated_at_idx on public.presentations (updated_at desc) where is_published and from_admin;

-- Same as before, plus from_admin = whether the one saving is an admin.
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
    public.is_admin(),
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
    from_admin = excluded.from_admin,
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
