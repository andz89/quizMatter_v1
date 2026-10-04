-- Fixes from the whole-feature review of presentation reviews (see 20261019000000_presentation_reviews.sql):
-- 1. A round whose reviewer is gone (their account was deleted, so reviewer_id became null) no longer locks the
--    presentation, and a new round can start on it. Before, nothing could end such a round.
-- 2. Admins can cancel any open round ("Cancel review" on Admin → Presentations → Under review), e.g. when an
--    editor stops answering. Same as Stop review: the draft goes, the live presentation stays as it was.
-- 3. A draft must pass the same checks as the presentations and slides tables (each slide an object with its own
--    id, at most 2 MB, details within their lengths), so a draft sent around the app can't be one that publish
--    can never save.
-- 4. A banned reviewer's round can't be published (it would list them under "Reviewed by"). Error QMBRV.
--
-- Note: while one of an admin's presentations is under review, deleting that admin's account fails (the lock
-- refuses deleting the presentation). Cancel the review first.

-- ─── 1. Only a round with a reviewer locks ─────────────────────────────────────────────────────────────────

create or replace function public.is_review_locked(target_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.presentation_reviews r
    where r.presentation_id = target_id and r.status in ('reviewing', 'submitted') and r.reviewer_id is not null
  );
$$;

create or replace function public.review_status(target_id text)
returns table (status text, reviewer_name text, is_locked boolean, is_mine boolean, can_start boolean)
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
        and (r.last_reviewer_id is null or r.last_reviewer_id = (select auth.uid()) or r.open_to_all),
      false
    )
  from public.presentations p
  left join public.presentation_reviews r on r.presentation_id = p.id
  left join public.user_settings s on s.user_id = r.reviewer_id
  where p.id = target_id
    and (p.owner_id = (select auth.uid()) or public.is_admin() or (p.is_published and p.hidden_at is null));
$$;

create or replace function public.start_review(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews;
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
  if coalesce(review.status in ('reviewing', 'submitted') and review.reviewer_id is not null, false)
    or not (review.last_reviewer_id is null or review.last_reviewer_id = auth.uid() or review.open_to_all) then
    raise exception 'Someone else is reviewing this presentation.' using errcode = 'QMRVW';
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
    open_to_all = false
  where presentation_id = target_id;
end;
$$;

-- ─── 2. Admins can cancel a round ──────────────────────────────────────────────────────────────────────────

create function public.admin_cancel_review(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can cancel reviews.' using errcode = '42501';
  end if;
  perform public.cancel_review(target_id);
end;
$$;

revoke execute on function public.admin_cancel_review(text) from public, anon;
grant execute on function public.admin_cancel_review(text) to authenticated;

-- ─── 3. A draft passes the same checks as the tables it's published into ───────────────────────────────────

-- Same limits as the slides_data_is_small_object and presentations_details_size checks
-- (20261001000000_safer_presentation_saves.sql) and MAX_SLIDES in src/lib/schema.ts.
create or replace function public.check_review_draft(target_id text, review_draft jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  slide_count int := jsonb_array_length(coalesce(review_draft -> 'slides', '[]'));
begin
  if review_draft ->> 'id' is distinct from target_id then
    raise exception 'The draft is for another presentation.' using errcode = '22023';
  end if;
  if slide_count = 0 or slide_count > 100 then
    raise exception 'A presentation needs 1 to 100 slides.' using errcode = '22023';
  end if;
  if octet_length(review_draft::text) > 5000000 then
    raise exception 'The draft is too big.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(review_draft -> 'slides') as slide
    where jsonb_typeof(slide) <> 'object' or coalesce(slide ->> 'id', '') = '' or octet_length(slide::text) > 2000000
  ) or (
    select count(distinct slide ->> 'id') from jsonb_array_elements(review_draft -> 'slides') as slide
  ) <> slide_count then
    raise exception 'Every slide needs its own id and must be at most 2 MB.' using errcode = '22023';
  end if;
  if not coalesce(
    char_length(review_draft ->> 'title') <= 120
      and char_length(review_draft ->> 'description') <= 1000
      and char_length(review_draft ->> 'subject') <= 80
      and char_length(review_draft ->> 'curriculum') <= 80
      and char_length(review_draft ->> 'learningCompetency') <= 1000
      and jsonb_array_length(coalesce(review_draft -> 'referenceLinks', '[]')) <= 20,
    true
  ) then
    raise exception 'A detail of the draft is too long.' using errcode = '22023';
  end if;
end;
$$;

-- ─── 4. No publishing a banned reviewer ────────────────────────────────────────────────────────────────────

-- Same as before (20261021000000_review_approvals.sql), plus the banned-reviewer check.
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
    grade = d ->> 'grade',
    subject = d ->> 'subject',
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

  insert into public.presentation_reviewers (
    presentation_id, reviewer_id, name, email, background, reviewed_on, approved_by, approved_at
  )
  values (
    target_id, review.reviewer_id, f ->> 'name', f ->> 'email', f ->> 'background', (f ->> 'reviewedOn')::date,
    auth.uid(), now()
  )
  on conflict (presentation_id, reviewer_id) do update set
    name = excluded.name,
    email = excluded.email,
    background = excluded.background,
    reviewed_on = excluded.reviewed_on,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at;

  update public.presentation_reviews set
    status = 'published',
    ended_at = now(),
    last_reviewer_id = review.reviewer_id,
    draft = null,
    draft_updated_at = null,
    submitted_fields = null,
    admin_note = null
  where presentation_id = target_id;
end;
$$;

-- Ties on the review date keep one order (newest approval first), so the modal's cards don't swap around.
create or replace function public.admin_reviewers()
returns table (
  presentation_id text,
  name text,
  email text,
  background text,
  reviewed_on date,
  approved_at timestamptz,
  approver_name text,
  approver_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.presentation_id,
    r.name,
    r.email,
    r.background,
    r.reviewed_on,
    r.approved_at,
    coalesce(s.display_name, ''),
    coalesce(u.email, '')
  from public.presentation_reviewers r
  left join public.user_settings s on s.user_id = r.approved_by
  left join auth.users u on u.id = r.approved_by
  where public.is_admin()
  order by r.reviewed_on desc, r.approved_at desc nulls last;
$$;
