-- Presentation reviews: editors (teachers an admin trusts) check shared QuizMatter presentations.
-- An editor starts a review, changes a draft copy (teachers keep seeing the live one), and submits it with their
-- "Reviewed by" details. An admin then publishes it (the draft replaces the live presentation and the reviewer is
-- listed under "Reviewed by") or sends it back with a note. See
-- docs/superpowers/specs/2026-10-04-presentation-reviews-design.md.
--
-- Error codes the app shows a message for: QMREV = the presentation is under review, so it can't be changed;
-- QMRVW = you can't start or change this review right now; QM409 = the draft was saved in another tab.

-- ─── 1. Editors ────────────────────────────────────────────────────────────────────────────────────────────

create table public.editors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.editors enable row level security;

-- Admins give and take the role (Admin → Teachers). Teachers ask is_editor() instead of reading the table.
create policy "Admins manage editors" on public.editors
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- True when the logged-in user is an editor. "security definer" lets it read the editors table.
create function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.editors where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_editor() from public, anon;
grant execute on function public.is_editor() to authenticated;

-- ─── 2. Tables ─────────────────────────────────────────────────────────────────────────────────────────────

-- One row per presentation that has had a review: the latest round, and who may start the next one.
create table public.presentation_reviews (
  presentation_id text primary key references public.presentations (id) on delete cascade,
  -- The reviewer of the latest round.
  reviewer_id uuid references auth.users (id) on delete set null,
  -- reviewing → submitted → published, or back to reviewing (sent back), or canceled (Stop review).
  -- Only reviewing and submitted lock the presentation. Null = never reviewed yet.
  status text check (status in ('reviewing', 'submitted', 'canceled', 'published')),
  -- The reviewer's changed copy (same shape as the app's presentationSchema, with every slide).
  draft jsonb,
  draft_updated_at timestamptz,
  -- The reviewer's "Reviewed by" details, waiting for the admin: {name, email, background, reviewedOn}.
  submitted_fields jsonb,
  -- Why the admin sent it back.
  admin_note text check (char_length(admin_note) <= 500),
  started_at timestamptz,
  submitted_at timestamptz,
  ended_at timestamptz,
  -- Whose round the admin last published: only they may start the next one (unless open_to_all).
  last_reviewer_id uuid references auth.users (id) on delete set null,
  -- The admin's "Open to all editors" switch: any editor may start the next round. Off again once one starts.
  open_to_all boolean not null default false
);

alter table public.presentation_reviews enable row level security;

-- No direct writes: only the functions below change it. Its reviewer and admins may read the whole row.
create policy "Reviewer and admins read reviews" on public.presentation_reviews
  for select to authenticated
  using (reviewer_id = (select auth.uid()) or (select public.is_admin()));

-- The "Reviewed by" list: one row per reviewer per presentation, added (or updated) when an admin publishes.
create table public.presentation_reviewers (
  presentation_id text not null references public.presentations (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  background text not null check (char_length(background) between 1 and 1000),
  reviewed_on date not null,
  primary key (presentation_id, reviewer_id)
);

alter table public.presentation_reviewers enable row level security;

-- Anyone who can read the presentation (its rules apply inside this check) can read who reviewed it.
create policy "Read reviewers of readable presentations" on public.presentation_reviewers
  for select to authenticated
  using (exists (select 1 from public.presentations p where p.id = presentation_id));

-- ─── 3. Locking a presentation while it's under review ─────────────────────────────────────────────────────

create function public.is_review_locked(target_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.presentation_reviews r
    where r.presentation_id = target_id and r.status in ('reviewing', 'submitted')
  );
$$;

revoke execute on function public.is_review_locked(text) from public, anon;
grant execute on function public.is_review_locked(text) to authenticated;

-- publish_review sets quizmatter.publishing_review for its own changes; everything else is refused while
-- locked. Hiding (only hidden_at changes) is still allowed, so admins can still act on reports.
create function public.check_presentation_review_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('quizmatter.publishing_review', true), '') = 'yes' or not public.is_review_locked(old.id) then
    return coalesce(new, old);
  end if;
  -- tags_text is worked out by the database (null in NEW here), so it's left out of the comparison.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'hidden_at' - 'tags_text') = (to_jsonb(old) - 'hidden_at' - 'tags_text') then
    return new;
  end if;
  raise exception 'This presentation is under review.' using errcode = 'QMREV';
end;
$$;

create trigger presentation_review_lock
  before update or delete on public.presentations
  for each row execute function public.check_presentation_review_lock();

create function public.check_slide_review_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := case tg_op when 'DELETE' then old.presentation_id else new.presentation_id end;
begin
  if coalesce(current_setting('quizmatter.publishing_review', true), '') <> 'yes' and public.is_review_locked(target_id) then
    raise exception 'This presentation is under review.' using errcode = 'QMREV';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger slide_review_lock
  before insert or update or delete on public.slides
  for each row execute function public.check_slide_review_lock();

-- ─── 4. Status ─────────────────────────────────────────────────────────────────────────────────────────────

-- What the view page needs: the round's status, the reviewer's display name, whether it's locked, whether I'm
-- its reviewer, and whether I may start a review. No row if I can't read the presentation.
create function public.review_status(target_id text)
returns table (status text, reviewer_name text, is_locked boolean, is_mine boolean, can_start boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.status,
    coalesce(nullif(s.display_name, ''), 'An editor'),
    coalesce(r.status in ('reviewing', 'submitted'), false),
    coalesce(r.status in ('reviewing', 'submitted') and r.reviewer_id = (select auth.uid()), false),
    coalesce(
      public.is_editor()
        and not public.is_banned()
        and p.from_admin and p.is_published and p.hidden_at is null
        and coalesce(r.status not in ('reviewing', 'submitted'), true)
        and (r.last_reviewer_id is null or r.last_reviewer_id = (select auth.uid()) or r.open_to_all),
      false
    )
  from public.presentations p
  left join public.presentation_reviews r on r.presentation_id = p.id
  left join public.user_settings s on s.user_id = r.reviewer_id
  where p.id = target_id
    and (p.owner_id = (select auth.uid()) or public.is_admin() or (p.is_published and p.hidden_at is null));
$$;

revoke execute on function public.review_status(text) from public, anon;
grant execute on function public.review_status(text) to authenticated;

-- ─── 5. The reviewer's steps ───────────────────────────────────────────────────────────────────────────────

-- The draft must be this presentation, with 1 to 100 slides (MAX_SLIDES in src/lib/schema.ts), and not huge.
create function public.check_review_draft(target_id text, review_draft jsonb)
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
end;
$$;

revoke execute on function public.check_review_draft(text, jsonb) from public, anon, authenticated;

-- Starts a round with me as reviewer. Only editors, only shared QuizMatter presentations, one round at a time,
-- and only the last reviewer (unless never reviewed, or the admin opened it to all editors).
create function public.start_review(target_id text)
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
  if coalesce(review.status in ('reviewing', 'submitted'), false)
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

revoke execute on function public.start_review(text) from public, anon;
grant execute on function public.start_review(text) to authenticated;

-- My open round (status reviewing), locked for this transaction. Refuses (QMRVW) otherwise.
create function public.my_open_review(target_id text)
returns public.presentation_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews;
begin
  select * into review from public.presentation_reviews r where r.presentation_id = target_id for update;
  if not found or review.reviewer_id is distinct from auth.uid() or review.status is distinct from 'reviewing'
    or not public.is_editor() or public.is_banned() then
    raise exception 'You can''t change this review right now.' using errcode = 'QMRVW';
  end if;
  return review;
end;
$$;

revoke execute on function public.my_open_review(text) from public, anon, authenticated;

-- Saves my draft. `base_updated_at`: when the draft I'm editing was saved (Unix ms), or the live presentation's
-- save time when I have no draft yet. Refuses (QM409) if the draft was saved in another tab since. Returns the
-- new save time, the next save's base.
create function public.save_review_draft(target_id text, review_draft jsonb, base_updated_at bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews := public.my_open_review(target_id);
begin
  if review.draft_updated_at is not null
    and (base_updated_at is null or floor(extract(epoch from review.draft_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This draft was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  perform public.check_review_draft(target_id, review_draft);

  update public.presentation_reviews set draft = review_draft, draft_updated_at = now() where presentation_id = target_id;
  return floor(extract(epoch from now()) * 1000)::bigint;
end;
$$;

revoke execute on function public.save_review_draft(text, jsonb, bigint) from public, anon;
grant execute on function public.save_review_draft(text, jsonb, bigint) to authenticated;

-- Saves my draft and "Reviewed by" details and sends them to the admins (status submitted).
create function public.submit_review(target_id text, review_draft jsonb, fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews := public.my_open_review(target_id);
begin
  perform public.check_review_draft(target_id, review_draft);
  -- Same limits as reviewerSchema in src/lib/schema.ts. The date may be "tomorrow" in UTC for teachers ahead of it.
  if char_length(trim(fields ->> 'name')) not between 1 and 100
    or char_length(fields ->> 'email') not between 3 and 254
    or char_length(trim(fields ->> 'background')) not between 1 and 1000
    or (fields ->> 'reviewedOn')::date > current_date + 1 then
    raise exception 'The reviewer details aren''t valid.' using errcode = '22023';
  end if;

  update public.presentation_reviews set
    draft = review_draft,
    draft_updated_at = now(),
    submitted_fields = jsonb_build_object(
      'name', trim(fields ->> 'name'),
      'email', fields ->> 'email',
      'background', trim(fields ->> 'background'),
      'reviewedOn', fields ->> 'reviewedOn'
    ),
    status = 'submitted',
    submitted_at = now(),
    admin_note = null
  where presentation_id = target_id;
end;
$$;

revoke execute on function public.submit_review(text, jsonb, jsonb) from public, anon;
grant execute on function public.submit_review(text, jsonb, jsonb) to authenticated;

-- Ends a round without changing the live presentation: the draft goes and the round shows as canceled.
create function public.cancel_review(target_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.presentation_reviews set
    status = 'canceled',
    ended_at = now(),
    draft = null,
    draft_updated_at = null,
    submitted_fields = null
  where presentation_id = target_id and status in ('reviewing', 'submitted');
$$;

revoke execute on function public.cancel_review(text) from public, anon, authenticated;

-- "Stop review": only the round's reviewer.
create function public.stop_review(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.presentation_reviews r
    where r.presentation_id = target_id and r.reviewer_id = auth.uid() and r.status in ('reviewing', 'submitted')
  ) then
    raise exception 'You can''t stop this review.' using errcode = 'QMRVW';
  end if;
  perform public.cancel_review(target_id);
end;
$$;

revoke execute on function public.stop_review(text) from public, anon;
grant execute on function public.stop_review(text) to authenticated;

-- Taking the editor role away cancels their open rounds, so no presentation stays locked.
create function public.cancel_reviews_of_removed_editor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.cancel_review(r.presentation_id)
  from public.presentation_reviews r
  where r.reviewer_id = old.user_id and r.status in ('reviewing', 'submitted');
  return old;
end;
$$;

create trigger cancel_reviews_of_removed_editor
  after delete on public.editors
  for each row execute function public.cancel_reviews_of_removed_editor();

-- ─── 6. The admin's steps ──────────────────────────────────────────────────────────────────────────────────

-- Publishes a submitted round: the draft replaces the live presentation's details (not its author, owner,
-- sharing or "from QuizMatter") and slides, and the reviewer goes on the "Reviewed by" list.
create function public.publish_review(target_id text)
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

  insert into public.presentation_reviewers (presentation_id, reviewer_id, name, email, background, reviewed_on)
  values (target_id, review.reviewer_id, f ->> 'name', f ->> 'email', f ->> 'background', (f ->> 'reviewedOn')::date)
  on conflict (presentation_id, reviewer_id) do update set
    name = excluded.name,
    email = excluded.email,
    background = excluded.background,
    reviewed_on = excluded.reviewed_on;

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

revoke execute on function public.publish_review(text) from public, anon;
grant execute on function public.publish_review(text) to authenticated;

-- Sends a submitted round back to its reviewer with a note. Their details stay, so the form is filled next time.
create function public.send_back_review(target_id text, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can send reviews back.' using errcode = '42501';
  end if;
  if char_length(trim(note)) not between 1 and 500 then
    raise exception 'The note must be 1 to 500 characters.' using errcode = '22023';
  end if;
  update public.presentation_reviews set status = 'reviewing', admin_note = trim(note), submitted_at = null
  where presentation_id = target_id and status = 'submitted';
  if not found then
    raise exception 'This review isn''t waiting to be published.' using errcode = 'QMRVW';
  end if;
end;
$$;

revoke execute on function public.send_back_review(text, text) from public, anon;
grant execute on function public.send_back_review(text, text) to authenticated;

-- The "Open to all editors" switch, for QuizMatter presentations.
create function public.set_review_open(target_id text, is_open boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.presentations p where p.id = target_id and p.from_admin) then
    raise exception 'Only QuizMatter presentations can be reviewed.' using errcode = 'QMRVW';
  end if;
  insert into public.presentation_reviews (presentation_id, open_to_all) values (target_id, is_open)
  on conflict (presentation_id) do update set open_to_all = excluded.open_to_all;
end;
$$;

revoke execute on function public.set_review_open(text, boolean) from public, anon;
grant execute on function public.set_review_open(text, boolean) to authenticated;

-- ─── 7. Lists ──────────────────────────────────────────────────────────────────────────────────────────────

-- My open rounds, for the home page's "My reviews" row.
create function public.my_reviews()
returns table (presentation_id text, title text, status text, admin_note text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.presentation_id, p.title, r.status, r.admin_note
  from public.presentation_reviews r
  join public.presentations p on p.id = r.presentation_id
  where r.reviewer_id = (select auth.uid()) and r.status in ('reviewing', 'submitted')
  order by r.started_at desc;
$$;

revoke execute on function public.my_reviews() from public, anon;
grant execute on function public.my_reviews() to authenticated;

-- Every round that's going on or was canceled, for Admin → Presentations → Under review. Admins only (others get
-- no rows).
create function public.admin_reviews()
returns table (
  presentation_id text,
  title text,
  reviewer_name text,
  status text,
  started_at timestamptz,
  submitted_at timestamptz,
  ended_at timestamptz
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
    r.ended_at
  from public.presentation_reviews r
  join public.presentations p on p.id = r.presentation_id
  left join public.user_settings s on s.user_id = r.reviewer_id
  left join auth.users u on u.id = r.reviewer_id
  where public.is_admin() and r.status in ('reviewing', 'submitted', 'canceled')
  order by coalesce(r.submitted_at, r.ended_at, r.started_at) desc;
$$;

revoke execute on function public.admin_reviews() from public, anon;
grant execute on function public.admin_reviews() to authenticated;

-- ─── 8. Photo cleanup ──────────────────────────────────────────────────────────────────────────────────────

-- Same as before (20261003000000_slide_photos.sql), plus photos in review drafts, so the weekly cleanup never
-- deletes a photo only a draft uses.
create or replace function public.used_photo_srcs()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct used.src), '{}')
  from (
    select p.src from public.photos p
    union
    select sp.src from public.shared_photos sp
    union
    select slp.src from public.slide_photos slp
    union
    select unnest(public.slide_photo_srcs(r.draft)) from public.presentation_reviews r where r.draft is not null
  ) as used (src);
$$;
