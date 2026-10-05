-- Two changes to presentation reviews (see docs/superpowers/specs/2026-10-04-presentation-reviews-design.md):
-- 1. After an admin publishes a review, nobody (not even its last reviewer) can start a new one until an admin
--    turns on "Open to all editors". A presentation never reviewed stays open to any editor.
-- 2. Canceled rounds stay in the reviewer's "My reviews" tab, saying who canceled them (the admin or the reviewer).

-- ─── 1. Who canceled the round ─────────────────────────────────────────────────────────────────────────────

-- True: an admin canceled it (Cancel review, or took the editor role away). False: the reviewer's Stop review.
alter table public.presentation_reviews add column canceled_by_admin boolean not null default false;

create function public.cancel_review(target_id text, by_admin boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.presentation_reviews set
    status = 'canceled',
    canceled_by_admin = by_admin,
    ended_at = now(),
    draft = null,
    draft_updated_at = null,
    submitted_fields = null
  where presentation_id = target_id and status in ('reviewing', 'submitted');
$$;
revoke execute on function public.cancel_review(text, boolean) from public, anon, authenticated;

create or replace function public.stop_review(target_id text)
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
  perform public.cancel_review(target_id, false);
end;
$$;

create or replace function public.admin_cancel_review(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can cancel reviews.' using errcode = '42501';
  end if;
  perform public.cancel_review(target_id, true);
end;
$$;

create or replace function public.cancel_reviews_of_removed_editor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.cancel_review(r.presentation_id, true)
  from public.presentation_reviews r
  where r.reviewer_id = old.user_id and r.status in ('reviewing', 'submitted');
  return old;
end;
$$;

drop function public.cancel_review(text);

-- ─── 2. Who may start a review ─────────────────────────────────────────────────────────────────────────────

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
  if coalesce(review.status in ('reviewing', 'submitted') and review.reviewer_id is not null, false) then
    raise exception 'Someone else is reviewing this presentation.' using errcode = 'QMRVW';
  end if;
  -- Reviewed and published before: only "Open to all editors" lets anyone start again.
  if not (review.last_reviewer_id is null or review.open_to_all) then
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
    open_to_all = false
  where presentation_id = target_id;
end;
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
        and (r.last_reviewer_id is null or r.open_to_all),
      false
    )
  from public.presentations p
  left join public.presentation_reviews r on r.presentation_id = p.id
  left join public.user_settings s on s.user_id = r.reviewer_id
  where p.id = target_id
    and (p.owner_id = (select auth.uid()) or public.is_admin() or (p.is_published and p.hidden_at is null));
$$;

-- ─── 3. My reviews: open and canceled rounds ───────────────────────────────────────────────────────────────

-- The return columns change, so it's dropped and made again.
drop function public.my_reviews();
create function public.my_reviews()
returns table (presentation_id text, title text, status text, admin_note text, canceled_by_admin boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.presentation_id, p.title, r.status, r.admin_note, r.canceled_by_admin
  from public.presentation_reviews r
  join public.presentations p on p.id = r.presentation_id
  where r.reviewer_id = (select auth.uid()) and r.status in ('reviewing', 'submitted', 'canceled')
  order by coalesce(r.ended_at, r.started_at) desc;
$$;
revoke execute on function public.my_reviews() from public, anon;
grant execute on function public.my_reviews() to authenticated;
