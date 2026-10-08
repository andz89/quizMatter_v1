-- The Browse page's grade × subject grid: how many shared presentations (From QuizMatter and other teachers'
-- published ones, not the caller's own) each grade and subject has. Only the counts come back, not the rows, so the
-- page stays light however many presentations there are. The app puts subjects not on its list under "Other".
--
-- Security invoker: the caller's own read rules apply, so nothing they can't see is counted.
create function public.browse_counts()
returns table (grade text, subject text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.grade, p.subject, count(*)
  from public.presentations p
  where p.is_published and p.hidden_at is null and p.owner_id <> auth.uid() and p.grade <> '' and p.subject <> ''
  group by p.grade, p.subject;
$$;

revoke execute on function public.browse_counts() from public, anon;
grant execute on function public.browse_counts() to authenticated;
