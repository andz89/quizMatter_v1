-- Published lessons can be read (only read) by every logged-in user, so the home page can list other
-- teachers' lessons and /lesson/[id] can show them. Changing a lesson is still only allowed to its owner
-- (the "Own quizzes" and "Slides of own quizzes" policies).

create policy "Read published quizzes" on public.quizzes
  for select to authenticated
  using (is_published);

create policy "Read slides of published quizzes" on public.slides
  for select to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.is_published));

-- The home page lists published lessons newest first.
create index quizzes_published_updated_at_idx on public.quizzes (updated_at desc) where is_published;
