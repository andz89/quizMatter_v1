-- An author's published update stays on their Reviews & submissions page ("Update · published <date>").
-- A published author update adds no "Reviewed by" row (20261202000000_author_updates.sql), so the page's Published
-- rows (which come from that list) never showed it: once published, it vanished. my_reviews now also returns the
-- latest round of each lesson when it's my published update (only the latest: a lesson keeps one round), while the
-- lesson is still live. Same as before otherwise, plus ended_at; published rows come last.

drop function public.my_reviews();
create function public.my_reviews()
returns table (
  presentation_id text, title text, status text, admin_note text, canceled_by_admin boolean, is_author_update boolean,
  started_at timestamptz, submitted_at timestamptz, ended_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.presentation_id, p.title, r.status, r.admin_note, r.canceled_by_admin, r.is_author_update, r.started_at,
    r.submitted_at, r.ended_at
  from public.presentation_reviews r
  join public.presentations p on p.id = r.presentation_id
  where r.reviewer_id = (select auth.uid())
    and (
      r.status in ('reviewing', 'submitted', 'canceled')
      or (r.status = 'published' and r.is_author_update and p.is_published and p.hidden_at is null)
    )
  order by r.status = 'published', coalesce(r.ended_at, r.started_at) desc;
$$;
revoke execute on function public.my_reviews() from public, anon;
grant execute on function public.my_reviews() to authenticated;
