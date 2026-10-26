-- Admin numbers that count what their words say (docs/superpowers/specs/2026-10-24-review-fixes-design.md, H6, H7).
-- 1. "Reviews submitted" on Admin → Overview counted presentation_reviews.submitted_at, which send_back_review
--    empties, so a round an admin sent back vanished from the chart. Each round now keeps its first submit's time in
--    first_submitted_at: submit_review sets it once, a send-back or a cancel keeps it, start_review (a new round)
--    empties it. No log records a submit to count instead: activity_events (20261207000000_admin_overview.sql) has
--    only likes, saves and reports, and the Admin log (admin_actions) only admins' steps. presentation_reviews still
--    keeps only each presentation's latest round, so the chart counts those only (its caption says so).
-- 2. admin_editors(): Admin → Editors' emails and numbers (presentations, photos, published reviews) in one call.
--    The page used to list every account and read every row of those tables, and Supabase sends at most 1,000 rows
--    per request, so big numbers came out too small.
-- Test: supabase/tests/admin_overview_counts.sql.

-- ─── 1. A round's first submit ────────────────────────────────────────────────────────────────────────────────
alter table public.presentation_reviews add column first_submitted_at timestamptz;

-- Existing rounds, as well as the saved data allows:
-- - sent back at least once: the Admin log's first "sent back" of this round (on or after its start); the submit
--   came just before it. This also covers a round sent back and then submitted again, whose submitted_at is the
--   second submit.
-- - else its submitted_at (submitted, published, or canceled while waiting): never sent back, so that is the first.
-- - sent back before the Admin log existed (it has an admin note but no submitted_at): only the round's start is
--   known, so that day is used.
-- Rounds never submitted stay empty.
update public.presentation_reviews r set first_submitted_at = coalesce(
  (
    select min(a.created_at) from public.admin_actions a
    where a.action = 'review_sent_back' and a.target_id = r.presentation_id and a.created_at >= r.started_at
  ),
  r.submitted_at,
  case when r.admin_note is not null then r.started_at end
)
where r.submitted_at is not null or r.admin_note is not null;

-- ─── 2. start_review: same as before (20261202000000_author_updates.sql), plus first_submitted_at = null ──────
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
    -- A new round: not submitted yet.
    first_submitted_at = null,
    ended_at = null,
    canceled_by_admin = false,
    is_author_update = is_author,
    -- The author's update leaves "Open to all editors" as it was.
    open_to_all = case when is_author then open_to_all else false end
  where presentation_id = target_id;
end;
$$;

-- ─── 3. submit_review: same as before (20261209000000_data_version.sql), plus first_submitted_at ──────────────
create or replace function public.submit_review(target_id text, review_draft jsonb, reviewed_on date, base_updated_at bigint, app_version int default 0)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews := public.my_open_review(target_id);
  reviewer_email text;
  reviewer_name text;
begin
  perform public.check_review_version(review, app_version);
  if review.draft_updated_at is not null
    and (base_updated_at is null or floor(extract(epoch from review.draft_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This draft was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  perform public.check_review_draft(target_id, review_draft);
  -- The reviewer's "today": one day either side of the server's, for time zones ahead of or behind UTC.
  if reviewed_on is null or reviewed_on not between current_date - 1 and current_date + 1 then
    raise exception 'The review date isn''t valid.' using errcode = '22023';
  end if;

  select u.email into reviewer_email from auth.users u where u.id = auth.uid();
  if coalesce(reviewer_email, '') = '' then
    raise exception 'Your account has no email.' using errcode = '22023';
  end if;
  select coalesce(nullif(trim(s.display_name), ''), split_part(reviewer_email, '@', 1)) into reviewer_name
  from (select 1) as one
  left join public.user_settings s on s.user_id = auth.uid();

  update public.presentation_reviews set
    draft = review_draft,
    draft_updated_at = now(),
    draft_version = greatest(draft_version, coalesce(app_version, 0)),
    submitted_fields = jsonb_build_object(
      'name', left(reviewer_name, 100),
      'email', reviewer_email,
      'reviewedOn', reviewed_on
    ),
    status = 'submitted',
    submitted_at = now(),
    -- Only the round's first submit: submitting again after a send-back keeps it.
    first_submitted_at = coalesce(first_submitted_at, now()),
    admin_note = null
  where presentation_id = target_id;
end;
$$;

-- ─── 4. admin_overview: same as before (20261207000000_admin_overview.sql), reviews by their first submit ─────
-- Every admin sees the first seven series. Sign-ups, logins, pauses and bans are for the super admin only.
-- Reviews are counted on the day each round was first submitted, so a round sent back (or canceled after its submit)
-- still counts. Only each presentation's latest round is kept in presentation_reviews.
create or replace function public.admin_overview(days int)
returns table (series text, day date, total int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since timestamptz := ((now() at time zone 'utc')::date - (days - 1)) at time zone 'utc';
begin
  if not public.is_admin() then
    raise exception 'Only admins can see the overview.' using errcode = '42501';
  end if;
  if days not in (7, 30, 90) then
    raise exception 'days must be 7, 30 or 90.' using errcode = '22023';
  end if;

  return query
  select s.series, s.day, count(*)::int
  from (
    select case when p.shared_from is null then 'presentations' else 'publishes' end as series,
           (p.created_at at time zone 'utc')::date as day
      from public.presentations p where p.created_at >= since
    union all
    select case e.kind when 'like' then 'likes' when 'save' then 'saves' else 'reports' end,
           (e.created_at at time zone 'utc')::date
      from public.activity_events e where e.created_at >= since
    union all
    select 'submissions', (x.submitted_at at time zone 'utc')::date
      from public.presentation_submissions x where x.submitted_at >= since
    union all
    select 'reviews', (r.first_submitted_at at time zone 'utc')::date
      from public.presentation_reviews r where r.first_submitted_at >= since
    union all
    select 'signups', (u.created_at at time zone 'utc')::date
      from auth.users u where public.is_super_admin() and u.created_at >= since
    union all
    select 'logins', (u.last_sign_in_at at time zone 'utc')::date
      from auth.users u where public.is_super_admin() and u.last_sign_in_at >= since
    union all
    select case h.kind when 'pause' then 'pauses' else 'bans' end,
           (h.created_at at time zone 'utc')::date
      from public.click_history h
      where public.is_super_admin() and h.kind in ('pause', 'ban') and h.created_at >= since
  ) s
  group by s.series, s.day;
end;
$$;

-- ─── 5. admin_editors: every editor with what they made, for Admin → Editors ──────────────────────────────────
-- Their email (from auth.users, like admin_reviews, so the page doesn't ask Supabase for each account), presentations
-- they made (not shared copies, like their own lists), photos they uploaded ("My photos" rows), their reviews an
-- admin published ("Reviewed by" rows; an author update adds none) and the newest one's date.
-- Admins only: anyone else gets no rows (like admin_reviews).
create function public.admin_editors()
returns table (
  user_id uuid, email text, added_at timestamptz, presentations int, photos int, published_reviews int,
  last_review date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.user_id,
    coalesce(u.email, ''),
    e.added_at,
    (select count(*)::int from public.presentations p where p.owner_id = e.user_id and p.shared_from is null),
    (select count(*)::int from public.photos ph where ph.user_id = e.user_id),
    (select count(*)::int from public.presentation_reviewers r where r.reviewer_id = e.user_id),
    (select max(r.reviewed_on) from public.presentation_reviewers r where r.reviewer_id = e.user_id)
  from public.editors e
  join auth.users u on u.id = e.user_id
  where public.is_admin();
$$;

revoke execute on function public.admin_editors() from public, anon;
grant execute on function public.admin_editors() to authenticated;
