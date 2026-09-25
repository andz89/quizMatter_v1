-- Quizzes (parent) and their slides (child). A slide's full content (question, options, elements…)
-- is stored as one JSON value in `data`, shaped by `slideSchema` in src/lib/schema.ts.

create table public.quizzes (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quizzes_owner_id_idx on public.quizzes (owner_id);

create table public.slides (
  quiz_id text not null references public.quizzes (id) on delete cascade,
  id text not null,
  position int not null,
  data jsonb not null,
  primary key (quiz_id, id)
);

-- Each user can only see and change their own quizzes, and the slides inside them.
alter table public.quizzes enable row level security;
alter table public.slides enable row level security;

create policy "Own quizzes" on public.quizzes
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Slides of own quizzes" on public.slides
  for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = (select auth.uid())));

-- Saves a whole quiz in one transaction: the quiz row, every slide (in order), and removes slides
-- that were deleted. Runs as the calling user, so the policies above still apply.
create function public.save_quiz(quiz jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := quiz ->> 'id';
begin
  insert into public.quizzes (id, title, created_at, updated_at)
  values (target_id, quiz ->> 'title', to_timestamp((quiz ->> 'createdAt')::bigint / 1000.0), now())
  on conflict (id) do update set title = excluded.title, updated_at = now();

  delete from public.slides s
  where s.quiz_id = target_id
    and s.id not in (select slide ->> 'id' from jsonb_array_elements(quiz -> 'slides') as slide);

  insert into public.slides (quiz_id, id, position, data)
  select target_id, slide ->> 'id', (ord - 1)::int, slide
  from jsonb_array_elements(quiz -> 'slides') with ordinality as t(slide, ord)
  on conflict (quiz_id, id) do update set position = excluded.position, data = excluded.data;
end;
$$;

revoke execute on function public.save_quiz(jsonb) from public, anon;
grant execute on function public.save_quiz(jsonb) to authenticated;
