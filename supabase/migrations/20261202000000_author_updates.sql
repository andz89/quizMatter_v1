-- Author updates: the editor who made a QuizMatter lesson (its approved submission's editor, see lesson_editor in
-- 20261129000000_lesson_week.sql) can always change it through a review round, labeled "Update". An admin still
-- publishes it or sends it back. It works even when the lesson is closed to other editors, and publishing it changes
-- no review information: no "Reviewed by" row (so no Reviewer line or reviewed check), and other editors' access
-- (last_reviewer_id, open_to_all) stays as it was.

-- ─── 1. Which rounds are author updates ───────────────────────────────────────────────────────────────────
alter table public.presentation_reviews add column is_author_update boolean not null default false;

-- ─── 2. start_review: same as before (20261025000000_review_reopen_and_canceled.sql), plus the author ─────
create or replace function public.start_review(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews;
  -- The lesson's own editor (never true for a lesson an admin made).
  is_author boolean := coalesce(public.lesson_editor(target_id) = auth.uid(), false);
begin
  if not public.is_editor() or public.is_banned() then
    raise exception 'Only editors can review presentations.' using errcode = 'QMRVW';
  end if;
  if not exists (
    select 1 from public.presentations p
    where p.id = target_id and p.from_admin and p.is_published and p.hidden_at is null
  ) then
    raise exception 'Only shared QuizMatter presentations can be reviewed.' using errcode = 'QMRVW';
  end if;

  insert into public.presentation_reviews (presentation_id) values (target_id) on conflict do nothing;
  -- Locked until this ends, so two editors clicking at once can't both start.
  select * into review from public.presentation_reviews r where r.presentation_id = target_id for update;
  -- A round with no reviewer (their account is gone) doesn't count as open.
  if coalesce(review.status in ('reviewing', 'submitted') and review.reviewer_id is not null, false) then
    raise exception 'Someone else is reviewing this presentation.' using errcode = 'QMRVW';
  end if;
  -- Reviewed and published before: only "Open to all editors" lets anyone start again. The author always may.
  if not (is_author or review.last_reviewer_id is null or review.open_to_all) then
    raise exception 'This presentation was already reviewed. QuizMatter has to open it for review again.'
      using errcode = 'QMRVW';
  end if;

  update public.presentation_reviews set
    reviewer_id = auth.uid(),
    status = 'reviewing',
    draft = null,
    draft_updated_at = null,
    submitted_fields = null,
    admin_note = null,
    started_at = now(),
    submitted_at = null,
    ended_at = null,
    canceled_by_admin = false,
    is_author_update = is_author,
    -- The author's update leaves "Open to all editors" as it was.
    open_to_all = case when is_author then open_to_all else false end
  where presentation_id = target_id;
end;
$$;

-- ─── 3. review_status: plus whether the latest round is an author update, and whether I'm the author ───────
-- Its columns change, so it's dropped and made again.
drop function public.review_status(text);
create function public.review_status(target_id text)
returns table (
  status text, reviewer_name text, is_locked boolean, is_mine boolean, can_start boolean, is_author_update boolean,
  is_author boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.status,
    coalesce(nullif(s.display_name, ''), 'An editor'),
    coalesce(r.status in ('reviewing', 'submitted') and r.reviewer_id is not null, false),
    coalesce(r.status in ('reviewing', 'submitted') and r.reviewer_id = (select auth.uid()), false),
    coalesce(
      public.is_editor()
        and not public.is_banned()
        and p.from_admin and p.is_published and p.hidden_at is null
        and not public.is_review_locked(p.id)
        and (r.last_reviewer_id is null or r.open_to_all or public.lesson_editor(p.id) = (select auth.uid())),
      false
    ),
    coalesce(r.is_author_update, false),
    coalesce(public.lesson_editor(p.id) = (select auth.uid()), false)
  from public.presentations p
  left join public.presentation_reviews r on r.presentation_id = p.id
  left join public.user_settings s on s.user_id = r.reviewer_id
  where p.id = target_id
    and (p.owner_id = (select auth.uid()) or public.is_admin() or (p.is_published and p.hidden_at is null));
$$;
revoke execute on function public.review_status(text) from public, anon;
grant execute on function public.review_status(text) to authenticated;

-- ─── 4. publish_review: same as before (20261118000000_presentation_term.sql), but an author update changes ─
-- no review information.
create or replace function public.publish_review(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews;
  d jsonb;
  f jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can publish reviews.' using errcode = '42501';
  end if;
  select * into review from public.presentation_reviews r where r.presentation_id = target_id for update;
  if not found or review.status is distinct from 'submitted' or review.reviewer_id is null then
    raise exception 'This review isn''t waiting to be published.' using errcode = 'QMRVW';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = review.reviewer_id) then
    raise exception 'This reviewer is banned, so their review can''t be published.' using errcode = 'QMBRV';
  end if;
  d := review.draft;
  f := review.submitted_fields;

  -- Lets the lock triggers through for these changes only (until this transaction ends).
  perform set_config('quizmatter.publishing_review', 'yes', true);

  update public.presentations p set
    title = d ->> 'title',
    description = d ->> 'description',
    grades = public.grades_from(d),
    subject = d ->> 'subject',
    -- A draft saved before Term existed has none: keep it empty.
    term = coalesce(d ->> 'term', ''),
    -- A draft saved before Week and Day existed has none: keep them empty.
    week = coalesce(d ->> 'week', ''),
    day = coalesce(d ->> 'day', ''),
    curriculum = d ->> 'curriculum',
    learning_competency = d ->> 'learningCompetency',
    reference_links = array(select jsonb_array_elements_text(d -> 'referenceLinks')),
    tags = array(select jsonb_array_elements_text(coalesce(d -> 'tags', '[]'))),
    transition = coalesce(d ->> 'transition', 'slide'),
    transition_speed = coalesce((d ->> 'transitionSpeed')::smallint, 3),
    updated_at = now()
  where p.id = target_id;

  delete from public.slides s
  where s.presentation_id = target_id
    and s.id not in (select slide ->> 'id' from jsonb_array_elements(d -> 'slides') as slide);

  insert into public.slides (presentation_id, id, position, data)
  select target_id, slide ->> 'id', (ord - 1)::int, slide
  from jsonb_array_elements(d -> 'slides') with ordinality as t(slide, ord)
  on conflict (presentation_id, id) do update set position = excluded.position, data = excluded.data;

  perform set_config('quizmatter.publishing_review', '', true);

  -- The lesson's own editor updating it isn't a reviewer: no "Reviewed by" row, and other editors' access stays as
  -- it was (no last_reviewer_id change).
  if not review.is_author_update then
  insert into public.presentation_reviewers (
    presentation_id, reviewer_id, name, email, reviewed_on, approved_by, approved_at
  )
  values (
    target_id, review.reviewer_id, f ->> 'name', f ->> 'email', (f ->> 'reviewedOn')::date,
    auth.uid(), now()
  )
  on conflict (presentation_id, reviewer_id) do update set
    name = excluded.name,
    email = excluded.email,
    reviewed_on = excluded.reviewed_on,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at;
  end if;

  update public.presentation_reviews set
    status = 'published',
    ended_at = now(),
    last_reviewer_id = case when review.is_author_update then last_reviewer_id else review.reviewer_id end,
    draft = null,
    draft_updated_at = null,
    submitted_fields = null,
    admin_note = null
  where presentation_id = target_id;
end;
$$;

-- ─── 5. my_reviews: plus the update flag and its dates (the editor's Reviews & submissions page) ───────────
-- Its columns change, so it's dropped and made again.
drop function public.my_reviews();
create function public.my_reviews()
returns table (
  presentation_id text, title text, status text, admin_note text, canceled_by_admin boolean, is_author_update boolean,
  started_at timestamptz, submitted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.presentation_id, p.title, r.status, r.admin_note, r.canceled_by_admin, r.is_author_update, r.started_at,
    r.submitted_at
  from public.presentation_reviews r
  join public.presentations p on p.id = r.presentation_id
  where r.reviewer_id = (select auth.uid()) and r.status in ('reviewing', 'submitted', 'canceled')
  order by coalesce(r.ended_at, r.started_at) desc;
$$;
revoke execute on function public.my_reviews() from public, anon;
grant execute on function public.my_reviews() to authenticated;

-- ─── 6. admin_reviews: plus the update flag (Admin → Presentations → Under review) ─────────────────────────
-- Its columns change, so it's dropped and made again.
drop function public.admin_reviews();
create function public.admin_reviews()
returns table (
  presentation_id text,
  title text,
  reviewer_name text,
  status text,
  started_at timestamptz,
  submitted_at timestamptz,
  ended_at timestamptz,
  is_author_update boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.presentation_id,
    p.title,
    coalesce(nullif(s.display_name, '') || coalesce(' (' || u.email || ')', ''), u.email, 'Deleted account'),
    r.status,
    r.started_at,
    r.submitted_at,
    r.ended_at,
    r.is_author_update
  from public.presentation_reviews r
  join public.presentations p on p.id = r.presentation_id
  left join public.user_settings s on s.user_id = r.reviewer_id
  left join auth.users u on u.id = r.reviewer_id
  where public.is_admin() and r.status in ('reviewing', 'submitted', 'canceled')
  order by coalesce(r.submitted_at, r.ended_at, r.started_at) desc;
$$;
revoke execute on function public.admin_reviews() from public, anon;
grant execute on function public.admin_reviews() to authenticated;
