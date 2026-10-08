-- The "Reviewed by" form is gone. submit_review now takes the reviewer's name and email from their own account
-- (display name, or the part of the email before "@" when they have none), so nobody can type someone else's.
-- The app sends only the date (the reviewer's "today", in their own time zone). The background text is removed
-- everywhere, with its column.

-- ─── 1. submit_review: no more typed name, email or background ─────────────────────────────────────────────

drop function public.submit_review(text, jsonb, jsonb, bigint);

create function public.submit_review(target_id text, review_draft jsonb, reviewed_on date, base_updated_at bigint)
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
    submitted_fields = jsonb_build_object(
      'name', left(reviewer_name, 100),
      'email', reviewer_email,
      'reviewedOn', reviewed_on
    ),
    status = 'submitted',
    submitted_at = now(),
    admin_note = null
  where presentation_id = target_id;
end;
$$;

revoke execute on function public.submit_review(text, jsonb, date, bigint) from public, anon;
grant execute on function public.submit_review(text, jsonb, date, bigint) to authenticated;

-- ─── 2. Drop the background column (its column grant from 20261023000000_hide_review_approver.sql goes with it) ─

-- admin_reviewers() returns the column, so it goes first and comes back below without it.
drop function public.admin_reviewers();

alter table public.presentation_reviewers drop column background;

-- ─── 3. publish_review: same as before (20261031000000_multiple_grades.sql), without the background ────────

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

-- ─── 4. admin_reviewers(): same as before (20261022000000_review_fixes.sql), without the background ────────

create function public.admin_reviewers()
returns table (
  presentation_id text,
  name text,
  email text,
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

revoke execute on function public.admin_reviewers() from public, anon;
grant execute on function public.admin_reviewers() to authenticated;
