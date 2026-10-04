-- Who approved each reviewer (Admin → Presentations → Review column). publish_review records the admin and the
-- time; admin_reviewers() lists every reviewer with that admin's name and email. See the spec's addendum in
-- docs/superpowers/specs/2026-10-04-presentation-reviews-design.md.

alter table public.presentation_reviewers
  add column approved_by uuid references auth.users (id) on delete set null,
  add column approved_at timestamptz;

-- Same as before (20261019000000_presentation_reviews.sql), plus approved_by / approved_at on the reviewer's row.
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

-- Every reviewer of every presentation, with the approving admin's display name and email (auth.users is only
-- readable here). Admins only: others get no rows.
create function public.admin_reviewers()
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
  order by r.reviewed_on desc;
$$;

revoke execute on function public.admin_reviewers() from public, anon;
grant execute on function public.admin_reviewers() to authenticated;
