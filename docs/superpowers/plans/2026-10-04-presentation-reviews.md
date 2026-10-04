# Presentation Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins give teachers an "editor" role; editors review shared QuizMatter presentations in a draft
that only the admin can publish, and every published reviewer is listed under "Reviewed by".

**Architecture:** One Supabase migration adds `editors`, `presentation_reviews` (one row per presentation: the
current round + its draft) and `presentation_reviewers` (the published "Reviewed by" list), with `security
definer` functions that hold every rule, and triggers that lock a presentation while it's under review. The app
calls those functions: the view page (Review / Continue review / copy blocked / "Reviewed by"), the editor in a
new review mode (Save as draft, Submit for publishing, Stop review), Admin → Teachers (editor role), Admin →
Presentations (status, "Open to all editors", reviews list, review page with Publish / Send back), and a "My
reviews" row on the home page.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres, RLS, rpc), zod 4, zustand, sonner,
lucide-react, Tailwind classes from `globals.css`.

**Spec:** `docs/superpowers/specs/2026-10-04-presentation-reviews-design.md`

## Global Constraints

- Validate all input with zod right before every insert/update/rpc call; limits live in the zod schema (`src/lib/schema.ts`).
- One Spinner (`src/components/Spinner.tsx`), one top line (`TopLoadingBar` / `LinkPending`); a `loading.tsx` for slow pages (Admin pages are covered by `src/app/admin/loading.tsx`).
- Design system only: `bg-accent`, `rounded-card`, `rounded-button`, `rounded-dropdown`, `btn-press`, `-soft` fill + `-strong` text pills, Lucide icons with `size`. No new colors; Mint/Coral only for right/wrong, success/error, delete.
- Every save/change shows a sonner toast on success and on failure.
- No new packages.
- Reviewer field limits: name 1–100, email valid ≤ 254, background 1–1000, date not in the future. Send-back note 1–500.
- Reviewer can't change: author, Visibility, `from_admin`, owner. "Published by" shows "QuizMatter".
- Locked = status `reviewing` or `submitted`. `canceled` and `published` don't lock.
- Explain in plain English in comments, like the existing code.

## Review Focus

1. Two editors click Review at the same moment → only one becomes reviewer; the other gets "Someone else just started reviewing this." (`start_review` locks the row `for update`). Covered by the SQL check in Task 1.
2. The owning admin opens the editor (or Share / Make draft / Delete / Hide) while it's under review → edit page sends them to the view page; Share/Make draft/Delete are refused with QMREV and a toast; Hide still works (only `hidden_at` changes). SQL check in Task 1, UI in Tasks 4 and 6.
3. Reviewer has the editor open in two tabs → the older tab's "Save as draft" is refused with the QM409 "saved in another tab" message, not silently overwriting. SQL check in Task 1.
4. The admin removes a reviewer's editor role mid-review → the round becomes Canceled and the presentation unlocks. SQL check in Task 1.
5. A photo used only in a draft must survive the weekly photo cleanup → `used_photo_srcs` includes draft photos. SQL check in Task 1.

There's no unit-test runner in this project (adding one is a new dependency the spec doesn't include). Database
rules are checked with SQL run inside `begin … rollback` (nothing is kept); app code is checked with
`npx tsc --noEmit` and `npm run lint`. Live browser testing is left to the user (CLAUDE.md).

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261019000000_presentation_reviews.sql`

**Interfaces:**
- Produces (rpc names and arguments used by later tasks):
  - `is_editor() → boolean`
  - `review_status(target_id text) → table(status text, reviewer_name text, is_locked boolean, is_mine boolean, can_start boolean)` (no row if the presentation isn't readable)
  - `start_review(target_id text) → void`
  - `save_review_draft(target_id text, review_draft jsonb, base_updated_at bigint) → bigint`
  - `submit_review(target_id text, review_draft jsonb, fields jsonb) → void` (fields: `{name, email, background, reviewedOn}`)
  - `stop_review(target_id text) → void`
  - `publish_review(target_id text) → void` (admin)
  - `send_back_review(target_id text, note text) → void` (admin)
  - `set_review_open(target_id text, is_open boolean) → void` (admin)
  - `my_reviews() → table(presentation_id text, title text, status text, admin_note text)`
  - `admin_reviews() → table(presentation_id text, title text, reviewer_name text, status text, started_at timestamptz, submitted_at timestamptz, ended_at timestamptz)`
  - Tables readable by the app: `editors(user_id)` (admins), `presentation_reviews` (its reviewer, admins), `presentation_reviewers(presentation_id, reviewer_id, name, email, background, reviewed_on)` (anyone who can read the presentation).
  - Error codes: `QMREV` (locked), `QMRVW` (can't review / change this review now), `QM409` (draft saved in another tab), `22023` with message starting "A presentation needs" (slide count).

- [ ] **Step 1: Write the migration**

```sql
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
    public.is_editor()
      and not public.is_banned()
      and p.from_admin and p.is_published and p.hidden_at is null
      and coalesce(r.status not in ('reviewing', 'submitted'), true)
      and (r.last_reviewer_id is null or r.last_reviewer_id = (select auth.uid()) or r.open_to_all)
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
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP: `list_projects` to get the project id, then `apply_migration` with name
`presentation_reviews` and the file's SQL. If the Supabase MCP is unreachable, stop and tell the user to apply
`supabase/migrations/20261019000000_presentation_reviews.sql` (and go on with the app tasks meanwhile).

- [ ] **Step 3: Check the rules with SQL (nothing is kept)**

Run with `execute_sql`. It picks a shared QuizMatter presentation and a non-admin teacher, acts as them, and
`raise exception 'ALL CHECKS PASSED'` at the end rolls everything back (so seeing that message = success).

```sql
do $$
declare
  pid text;
  admin_id uuid;
  editor_id uuid;
  other_id uuid;
  t bigint;
  failed boolean;
begin
  select p.id, p.owner_id into pid, admin_id from public.presentations p
  where p.from_admin and p.is_published and p.hidden_at is null limit 1;
  select u.id into editor_id from auth.users u where u.id not in (select user_id from public.admins) order by u.created_at limit 1;
  select u.id into other_id from auth.users u where u.id not in (select user_id from public.admins) and u.id <> editor_id order by u.created_at limit 1;
  if pid is null or editor_id is null or other_id is null then raise exception 'Need a shared QuizMatter presentation and two teachers.'; end if;

  insert into public.editors (user_id) values (editor_id), (other_id) on conflict do nothing;

  -- Act as the editor.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  perform public.start_review(pid);

  -- Review Focus 1: a second editor can't start.
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  failed := false;
  begin perform public.start_review(pid); exception when sqlstate 'QMRVW' then failed := true; end;
  if not failed then raise exception 'Second editor could start a review'; end if;

  -- Review Focus 3: draft saves, and an old base is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id, 'role', 'authenticated')::text, true);
  t := public.save_review_draft(pid, jsonb_build_object('id', pid, 'title', 'Draft title',
    'slides', jsonb_build_array(jsonb_build_object('id', 's1', 'src', 'https://images.quizmatter.com/uploads/' || repeat('a', 64) || '.webp'))), null);
  failed := false;
  begin perform public.save_review_draft(pid, jsonb_build_object('id', pid, 'slides', jsonb_build_array(jsonb_build_object('id', 's1'))), t - 1);
  exception when sqlstate 'QM409' then failed := true; end;
  if not failed then raise exception 'Old draft save was not refused'; end if;

  -- Review Focus 5: the draft's photo counts as used.
  if not ('https://images.quizmatter.com/uploads/' || repeat('a', 64) || '.webp') = any (public.used_photo_srcs()) then
    raise exception 'Draft photo not in used_photo_srcs';
  end if;

  -- Review Focus 2: locked for the owner (a change refused), but hiding still works.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  failed := false;
  begin update public.presentations set title = 'x' where id = pid; exception when sqlstate 'QMREV' then failed := true; end;
  if not failed then raise exception 'Locked presentation could be changed'; end if;
  failed := false;
  begin delete from public.slides where presentation_id = pid; exception when sqlstate 'QMREV' then failed := true; end;
  if not failed then raise exception 'Locked slides could be deleted'; end if;
  update public.presentations set hidden_at = now() where id = pid;
  update public.presentations set hidden_at = null where id = pid;

  -- Review Focus 4: removing the editor role cancels the round and unlocks.
  delete from public.editors where user_id = editor_id;
  if public.is_review_locked(pid) then raise exception 'Removing the editor did not unlock'; end if;
  if (select status from public.presentation_reviews where presentation_id = pid) <> 'canceled' then
    raise exception 'Round not canceled';
  end if;

  raise exception 'ALL CHECKS PASSED';
end;
$$;
```

Expected: `ERROR: ALL CHECKS PASSED`. Any other message names the rule that failed; fix the migration (as a new
`create or replace` in the same file, re-applied) and run again.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261019000000_presentation_reviews.sql
git commit -m "Add presentation reviews to the database: editors, review rounds and the Reviewed by list"
```

---

### Task 2: Shared app code (schemas, account, review calls, status loading)

**Files:**
- Modify: `src/lib/schema.ts` (after `banSchema`)
- Modify: `src/lib/account.ts`
- Modify: `src/lib/presentations.ts` (`REFUSALS`)
- Create: `src/lib/reviewStatus.ts` (reads; works with the server or browser client)
- Create: `src/lib/reviews.ts` (the reviewer's writes; browser client)
- Modify: `src/lib/fetchPresentation.ts`

**Interfaces:**
- Consumes: Task 1 rpc names.
- Produces:
  - `reviewerSchema`, `type ReviewerFields = { name: string; email: string; background: string; reviewedOn: string }` (reviewedOn `YYYY-MM-DD`), `REVIEWER_MAX_LENGTH`, `reviewNoteSchema`, `REVIEW_NOTE_MAX_LENGTH`, `todayIso(): string`
  - `Account.isEditor: boolean`
  - `REFUSALS.QMREV`, `REFUSALS.QMRVW`
  - `type ReviewStatus = { status: "reviewing" | "submitted" | "canceled" | "published" | null; reviewerName: string; isLocked: boolean; isMine: boolean; canStart: boolean }`, `NO_REVIEW: ReviewStatus`, `loadReviewStatus(supabase, id): Promise<ReviewStatus>`, `type Reviewer = ReviewerFields`, `loadReviewers(supabase, id): Promise<Reviewer[]>`
  - `startReview(id): Promise<void>`, `saveReviewDraft(presentation, baseUpdatedAt): Promise<number>`, `submitReview(presentation, fields): Promise<void>`, `stopReview(id): Promise<void>` — all throw `SaveRefusedError` with the REFUSALS message, or ZodError.
  - `fetchPresentation` result gains `review: ReviewStatus` and `reviewers: Reviewer[]`.

- [ ] **Step 1: Add the schemas to `src/lib/schema.ts`** (after `banSchema`)

```ts
// Today as YYYY-MM-DD in the user's own time zone (what a date input shows).
export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// A reviewer's "Reviewed by" details (presentation reviews, see the presentation_reviews migration).
export const REVIEWER_MAX_LENGTH = { name: 100, email: 254, background: 1000 };
export const reviewerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Write the reviewer's name.")
    .max(REVIEWER_MAX_LENGTH.name, `The name is too long (${REVIEWER_MAX_LENGTH.name} characters at most).`),
  email: z.email("Write a valid email.").max(REVIEWER_MAX_LENGTH.email, "The email is too long."),
  background: z
    .string()
    .trim()
    .min(1, "Write the reviewer's education or current work.")
    .max(REVIEWER_MAX_LENGTH.background, `The background is too long (${REVIEWER_MAX_LENGTH.background} characters at most).`),
  reviewedOn: z.iso.date("Pick the review date.").refine((date) => date <= todayIso(), "The review date can't be in the future."),
});
export type ReviewerFields = z.infer<typeof reviewerSchema>;

// Why an admin sent a review back to its reviewer.
export const REVIEW_NOTE_MAX_LENGTH = 500;
export const reviewNoteSchema = z
  .string()
  .trim()
  .min(1, "Write what the reviewer should change.")
  .max(REVIEW_NOTE_MAX_LENGTH, `The note is too long (${REVIEW_NOTE_MAX_LENGTH} characters at most).`);
```

- [ ] **Step 2: `src/lib/account.ts`** — add `isEditor` to the type, the `Promise.all` (`supabase.rpc("is_editor")`), and the result (`isEditor: isEditor === true`). Update the doc comment: "…whether they're an admin, an editor (reviews QuizMatter presentations) or banned…".

- [ ] **Step 3: `src/lib/presentations.ts`** — add to `REFUSALS`:

```ts
  QMREV: "This presentation is under review, so it can't be changed right now.",
  QMRVW: "Someone else is reviewing this presentation, or you can't review it right now.",
```

- [ ] **Step 4: Create `src/lib/reviewStatus.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewerFields } from "./schema";

/**
 * A presentation's review (see the presentation_reviews migration): the latest round's status, its reviewer's
 * name, whether it's locked (reviewing or submitted), whether I'm its reviewer, and whether I may start one.
 */
export type ReviewStatus = {
  status: "reviewing" | "submitted" | "canceled" | "published" | null;
  reviewerName: string;
  isLocked: boolean;
  isMine: boolean;
  canStart: boolean;
};

export const NO_REVIEW: ReviewStatus = { status: null, reviewerName: "", isLocked: false, isMine: false, canStart: false };

/** One entry of a presentation's "Reviewed by" list. */
export type Reviewer = ReviewerFields;

/** The review status, with the server or browser client. Throws if the lookup fails. */
export async function loadReviewStatus(supabase: SupabaseClient, id: string): Promise<ReviewStatus> {
  const { data, error } = await supabase.rpc("review_status", { target_id: id }).maybeSingle<{
    status: ReviewStatus["status"];
    reviewer_name: string;
    is_locked: boolean;
    is_mine: boolean;
    can_start: boolean;
  }>();
  if (error) throw error;
  if (!data) return NO_REVIEW;
  return {
    status: data.status,
    reviewerName: data.reviewer_name,
    isLocked: data.is_locked,
    isMine: data.is_mine,
    canStart: data.can_start,
  };
}

/** Everyone who reviewed the presentation, newest review first. Throws if the lookup fails. */
export async function loadReviewers(supabase: SupabaseClient, id: string): Promise<Reviewer[]> {
  const { data, error } = await supabase
    .from("presentation_reviewers")
    .select("name, email, background, reviewed_on")
    .eq("presentation_id", id)
    .order("reviewed_on", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({ name: row.name, email: row.email, background: row.background, reviewedOn: row.reviewed_on }));
}
```

- [ ] **Step 5: Create `src/lib/reviews.ts`**

```ts
import { createClient } from "./supabase/client";
import { REFUSALS, SaveRefusedError } from "./presentations";
import { presentationSchema, reviewerSchema, savedPresentationSchema, type Presentation, type ReviewerFields } from "./schema";

// The reviewer's steps (see the presentation_reviews migration). Each is checked with zod right before the
// database call (see CLAUDE.md, "Saving Data"), and throws a SaveRefusedError with a message for refusals.

function throwIfRefused(error: { code: string; message: string } | null) {
  if (error && REFUSALS[error.code]) throw new SaveRefusedError(REFUSALS[error.code], error.code === "QM409");
  if (error?.code === "22023" && error.message.startsWith("A presentation needs")) throw new SaveRefusedError(error.message);
  if (error) throw error;
}

// The whole draft: details and every slide. Empty reference rows are dropped, like a normal save.
function parseDraft(presentation: Presentation) {
  const referenceLinks = presentation.referenceLinks.map((link) => link.trim()).filter(Boolean);
  return presentationSchema.parse({ ...presentation, referenceLinks });
}

/** Makes me the reviewer of this shared QuizMatter presentation. */
export async function startReview(id: string): Promise<void> {
  const { presentation_id } = savedPresentationSchema.parse({ presentation_id: id });
  const { error } = await createClient().rpc("start_review", { target_id: presentation_id });
  throwIfRefused(error);
}

/** Saves my draft. `baseUpdatedAt`: when the copy being edited was saved. Returns the new save time. */
export async function saveReviewDraft(presentation: Presentation, baseUpdatedAt: number | null): Promise<number> {
  const { data, error } = await createClient().rpc("save_review_draft", {
    target_id: presentation.id,
    review_draft: parseDraft(presentation),
    base_updated_at: baseUpdatedAt,
  });
  throwIfRefused(error);
  return data;
}

/** Saves my draft with my "Reviewed by" details and sends them to the admins. */
export async function submitReview(presentation: Presentation, fields: ReviewerFields): Promise<void> {
  const { error } = await createClient().rpc("submit_review", {
    target_id: presentation.id,
    review_draft: parseDraft(presentation),
    fields: reviewerSchema.parse(fields),
  });
  throwIfRefused(error);
}

/** Ends my review: the draft is thrown away and the live presentation stays as it was. */
export async function stopReview(id: string): Promise<void> {
  const { presentation_id } = savedPresentationSchema.parse({ presentation_id: id });
  const { error } = await createClient().rpc("stop_review", { target_id: presentation_id });
  throwIfRefused(error);
}
```

- [ ] **Step 6: `src/lib/fetchPresentation.ts`** — load the status and reviewers with the presentation:

```ts
import { loadReviewers, loadReviewStatus, type Reviewer, type ReviewStatus } from "./reviewStatus";
…
): Promise<{
  presentation: Presentation;
  isMine: boolean;
  publisherName: string;
  isSaved: boolean;
  review: ReviewStatus;
  reviewers: Reviewer[];
} | null> {
  const supabase = await createClient();
  const [result, { data: claims }, { data: saved }, review, reviewers] = await Promise.all([
    loadPresentation(supabase, id),
    supabase.auth.getClaims(),
    supabase.from("saved_presentations").select("presentation_id").eq("presentation_id", id).maybeSingle(),
    loadReviewStatus(supabase, id),
    loadReviewers(supabase, id),
  ]);
  …
  return { presentation, isMine, publisherName, isSaved: saved !== null, review, reviewers };
```

Update the doc comment: "`review`: its review status, `reviewers`: its "Reviewed by" list."

- [ ] **Step 7: Check**

Run: `npx tsc --noEmit` then `npm run lint`. Expected: no errors (the callers of `fetchPresentation` ignore the new fields until Task 4).

- [ ] **Step 8: Commit**

```bash
git add src/lib/schema.ts src/lib/account.ts src/lib/presentations.ts src/lib/reviewStatus.ts src/lib/reviews.ts src/lib/fetchPresentation.ts
git commit -m "Add review schemas, editor check and review calls"
```

---

### Task 3: Admin → Teachers: the editor role

**Files:**
- Modify: `src/app/admin/teachers/actions.ts`
- Modify: `src/app/admin/teachers/page.tsx`
- Modify: `src/app/admin/teachers/AdminTeachers.tsx`

**Interfaces:**
- Consumes: `editors` table (Task 1).
- Produces: `setEditor(userId: string, isEditor: boolean): Promise<string | null>`; `TeacherRow.isEditor: boolean`.

- [ ] **Step 1: Server action in `actions.ts`**

```ts
const editorSchema = z.object({ user_id: z.uuid(), isEditor: z.boolean() });

/**
 * Gives a teacher the editor role (they can review QuizMatter presentations) or takes it away. Taking it away
 * cancels any review they have open. Returns an error message, or null if it worked.
 */
export async function setEditor(userId: string, isEditor: boolean): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = editorSchema.safeParse({ user_id: userId, isEditor });
  if (!parsed.success) return "Couldn't change the editor role.";
  if (!(await getAccount()).isAdmin) return "Only admins can change the editor role.";

  const supabase = await createClient();
  const { error } = parsed.data.isEditor
    ? await supabase.from("editors").upsert({ user_id: parsed.data.user_id })
    : await supabase.from("editors").delete().eq("user_id", parsed.data.user_id);
  refresh();
  return error ? "Couldn't change the editor role. Please try again." : null;
}
```

- [ ] **Step 2: `page.tsx`** — add `admin.from("editors").select("user_id")` to the `Promise.all` (as `editors`), throw on its error, pass `editors.data.map((row) => row.user_id as string)` to `buildRows` as `editorIds`, and set `isEditor: editorSet.has(user.id)` on each row (`const editorSet = new Set(editorIds)`).

- [ ] **Step 3: `AdminTeachers.tsx`** — add `isEditor: boolean` to `TeacherRow` (comment: "Can review QuizMatter presentations."), an "Editor" pill next to "Admin" (`${pillClass} bg-accent-soft text-accent`), and a button before the Ban button for teachers that aren't banned:

```tsx
  const toggleEditor = () => {
    if (row.isEditor && !confirm(`Remove ${row.email} as editor? A review they have open is canceled.`)) return;
    startTransition(async () => {
      const error = await setEditor(row.id, !row.isEditor);
      if (error) toast.error(error);
      else toast.success(row.isEditor ? `${row.email} is no longer an editor.` : `${row.email} is an editor now.`);
    });
  };
…
          {!row.ban && reason === null && (
            <button type="button" onClick={toggleEditor} disabled={isBusy} className={smallButtonClass}>
              <ShieldCheckIcon size={14} />
              {row.isEditor ? "Remove editor" : "Make editor"}
            </button>
          )}
```

Import `ShieldCheckIcon` from `lucide-react` and `setEditor` from `./actions`. Add one sentence to the page text: "Editors can review QuizMatter presentations."

- [ ] **Step 4: Check** — `npx tsc --noEmit`, `npm run lint`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/teachers
git commit -m "Let admins give teachers the editor role"
```

---

### Task 4: View page: Review button, copy block, "Reviewed by"

**Files:**
- Modify: `src/app/presentation/[id]/page.tsx`
- Modify: `src/app/presentation/[id]/PresentationPreview.tsx`

**Interfaces:**
- Consumes: `fetchPresentation(...).review/.reviewers`, `startReview`, `loadReviewStatus`, `saveErrorMessage`, `SaveRefusedError`.

- [ ] **Step 1: `page.tsx`** — pass `review={result.review}` and `reviewers={result.reviewers}` to `PresentationPreview`.

- [ ] **Step 2: `PresentationPreview.tsx` props and state**

```tsx
  review: ReviewStatus;
  reviewers: Reviewer[];
…
  const [isStartingReview, setIsStartingReview] = useState(false);
```

Update the doc comment: "…Editors can review a shared QuizMatter presentation ("Review"); while it's under review nobody can copy it, and its owner can't edit it."

- [ ] **Step 3: Start review, and check before copying**

```tsx
  const beginReview = async () => {
    setIsStartingReview(true);
    try {
      await startReview(presentation.id);
      // isStartingReview stays true, so the spinner and top line keep showing until the editor opens.
      router.push(`/presentation/${presentation.id}/edit`);
    } catch (error) {
      toast.error(error instanceof SaveRefusedError ? "Someone else just started reviewing this." : saveErrorMessage(error, "start the review"));
      setIsStartingReview(false);
      router.refresh();
    }
  };
```

At the top of `makeCopy`, before `setIsCopying(true)`'s save:

```tsx
    // It may have gone under review since the page opened.
    try {
      if ((await loadReviewStatus(createClient(), presentation.id)).isLocked) {
        toast.error("This presentation is under review, so it can't be copied right now.");
        setIsCopying(false);
        router.refresh();
        return;
      }
    } catch {
      // The check failed (connection): the copy below fails too and says so.
    }
```

(`import { createClient } from "@/lib/supabase/client"`.)

- [ ] **Step 4: Buttons in the header** (keep the existing order; changes only)

```tsx
          {review.isLocked && (
            <span className="rounded-dropdown bg-highlight-soft px-2.5 py-1 text-[13px] leading-none font-semibold text-highlight-strong">
              Under review
            </span>
          )}
          {review.canStart && (
            <button type="button" onClick={beginReview} disabled={isStartingReview} className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}>
              {isStartingReview ? <Spinner size={14} /> : <ClipboardCheckIcon size={16} />}
              Review
            </button>
          )}
          {review.isMine && (
            <Link href={`/presentation/${presentation.id}/edit`} className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}>
              <ClipboardCheckIcon size={16} />
              Continue review
              <LinkPending />
            </Link>
          )}
```

- The owner's **Edit** link only shows when `!review.isLocked`.
- **Make a copy**: `disabled={isCopying || review.isLocked}` and `title={review.isLocked ? "Under review: it can be copied once QuizMatter publishes the review." : undefined}`.
- Add `{isStartingReview && <TopLoadingBar />}` next to the copying one.

- [ ] **Step 5: "Reviewed by" in the details card** — include `reviewers.length > 0` in the card's show condition and add after References:

```tsx
          {reviewers.length > 0 && (
            <div>
              <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Reviewed by</dt>
              {reviewers.map((reviewer) => (
                <dd key={`${reviewer.email}-${reviewer.reviewedOn}`} className="mt-2 text-text-primary">
                  <span className="font-semibold">{reviewer.name}</span>
                  <span className="text-text-secondary"> · {reviewer.email} · {formatDay(reviewer.reviewedOn)}</span>
                  <span className="mt-0.5 block whitespace-pre-line text-text-secondary">{reviewer.background}</span>
                </dd>
              ))}
            </div>
          )}
```

Add to `src/lib/format.ts`:

```ts
/** "Oct 4, 2026" from "2026-10-04" (a date with no time, so no time zone shift). */
export function formatDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
```

- [ ] **Step 6: Check** — `npx tsc --noEmit`, `npm run lint`. Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/presentation/[id]/page.tsx" "src/app/presentation/[id]/PresentationPreview.tsx" src/lib/format.ts
git commit -m "Show Review, Under review and Reviewed by on the presentation page"
```

---

### Task 5: Editor review mode

**Files:**
- Modify: `src/app/presentation/[id]/edit/page.tsx`
- Modify: `src/app/presentation/[id]/edit/PresentationEditor.tsx`
- Modify: `src/components/editor/Editor.tsx`
- Modify: `src/lib/store.ts`
- Modify: `src/components/editor/EditorTopBar.tsx`
- Modify: `src/components/editor/DetailsPanel.tsx`
- Create: `src/components/editor/ReviewControls.tsx`

**Interfaces:**
- Consumes: `fetchPresentation`, `saveReviewDraft`, `submitReview`, `stopReview`, `reviewerSchema`, `todayIso`, `getAccount`.
- Produces: `type EditorReview = { status: "reviewing" | "submitted"; note: string; fields: ReviewerFields }` (exported from `store.ts`); store `review: EditorReview | null`.

- [ ] **Step 1: `edit/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { getAccount } from "@/lib/account";
import { fetchPresentation } from "@/lib/fetchPresentation";
import { presentationSchema, todayIso, type ReviewerFields } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import type { EditorReview } from "@/lib/store";
import { PresentationEditor } from "./PresentationEditor";

export default async function PresentationPage({ params }: PageProps<"/presentation/[id]/edit">) {
  const { id } = await params;
  const result = await fetchPresentation(id);
  // Also covers someone else's private presentation: the database hides it, so it looks like it doesn't exist.
  if (!result) notFound();
  // My own presentation, unless it's under review (then only its reviewer may change it).
  if (result.isMine && !result.review.isLocked) return <PresentationEditor presentation={result.presentation} />;
  // Someone else's published presentation can be viewed, not edited, unless I'm reviewing it.
  if (!result.review.isMine) redirect(`/presentation/${id}`);

  // My review: open my draft (or the live presentation, before my first save), keeping the live author.
  const supabase = await createClient();
  const [{ data: row, error }, account] = await Promise.all([
    supabase
      .from("presentation_reviews")
      .select("status, draft, draft_updated_at, submitted_fields, admin_note")
      .eq("presentation_id", id)
      .single(),
    getAccount(),
  ]);
  if (error) throw error;
  const presentation = row.draft
    ? presentationSchema.parse({ ...row.draft, author: result.presentation.author, updatedAt: Date.parse(row.draft_updated_at) })
    : result.presentation;
  const myEntry = result.reviewers.find((reviewer) => reviewer.email === account.email);
  const fields: ReviewerFields = (row.submitted_fields as ReviewerFields | null) ??
    myEntry ?? { name: account.displayName, email: account.email, background: "", reviewedOn: todayIso() };
  const review: EditorReview = { status: row.status, note: row.admin_note ?? "", fields };

  return <PresentationEditor presentation={presentation} review={review} />;
}
```

- [ ] **Step 2: Pass `review` through** — `PresentationEditor` gets `review?: EditorReview` and passes it to `<Editor review={review} />`. In `Editor.tsx` add the prop and, in the load effect right after `store.loadPresentation(presentation)`:

```tsx
    // A review opens in review mode: saves go to the draft (see the presentation_reviews migration).
    useEditorStore.setState({ review: review ?? null });
```

(add `review` to the effect's dependencies). Under `<EditorTopBar />` render `<ReviewBanner />` (from `ReviewControls.tsx`).

- [ ] **Step 3: `store.ts`**

In `EditorState`:

```ts
  // Set while an editor reviews someone else's QuizMatter presentation: saves go to their draft, and nothing
  // is saved once it's submitted. null = a normal presentation.
  review: EditorReview | null;
```

Export near the top:

```ts
export type EditorReview = { status: "reviewing" | "submitted"; note: string; fields: ReviewerFields };
```

Initial `review: null`; `loadPresentation` also sets `review: null`. In `savePresentation`:

```ts
    const { presentation, savedPresentation, savedAt, saveStatus, fromDraft, review } = get();
    if (saveStatus === "saving") return false;
    // A submitted review waits for an admin: nothing more is saved.
    if (review?.status === "submitted") return false;
…
      const newSavedAt = review
        ? await saveReviewDraft(presentation, savedAt)
        : await savePresentationToDb(presentation, {
            baseUpdatedAt: savedAt,
            savedSlides: savedAt === null ? undefined : savedPresentation?.slides,
          });
…
      if (!quiet) toast.success(review ? "Draft saved. Teachers still see the old version." : "Presentation saved.");
```

(imports: `saveReviewDraft` from `./reviews`, `ReviewerFields` from `./schema`.)

- [ ] **Step 4: `ReviewControls.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SendIcon, XCircleIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { saveErrorMessage } from "@/lib/presentations";
import { stopReview, submitReview } from "@/lib/reviews";
import { REVIEWER_MAX_LENGTH, reviewerSchema, todayIso, type ReviewerFields } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

/**
 * The reviewer's buttons in the editor's top bar: "Stop review" and "Submit for publishing" (which asks for the
 * "Reviewed by" details first). Once submitted, only a "Waiting for QuizMatter" label.
 */
export function ReviewControls() {
  const router = useRouter();
  const review = useEditorStore((s) => s.review);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  if (!review) return null;

  if (review.status === "submitted") {
    return (
      <span className="rounded-dropdown bg-bg-page px-2.5 py-1 text-[13px] leading-none font-semibold text-text-secondary">
        Waiting for QuizMatter
      </span>
    );
  }

  const stop = async () => {
    if (!confirm("Stop this review? Your changes are thrown away and the presentation stays as it was.")) return;
    const { presentation } = useEditorStore.getState();
    setIsStopping(true);
    try {
      await stopReview(presentation.id);
      toast.success("Review stopped. Nothing was changed.");
      // Nothing left to save, so leaving doesn't ask "Leave without saving?".
      useEditorStore.setState({ savedPresentation: presentation, review: null });
      router.push(`/presentation/${presentation.id}`);
    } catch (error) {
      toast.error(saveErrorMessage(error, "stop the review"));
      setIsStopping(false);
    }
  };

  return (
    <>
      <button type="button" onClick={stop} disabled={isStopping} className={secondaryButtonClass}>
        {isStopping ? <Spinner size={14} /> : <XCircleIcon size={16} />}
        <span className="hidden sm:inline">Stop review</span>
      </button>
      <button
        type="button"
        onClick={() => setIsFormOpen(true)}
        className="flex items-center gap-2 rounded-button bg-accent btn-press px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:px-4"
      >
        <SendIcon size={14} />
        <span className="hidden sm:inline">Submit for publishing</span>
      </button>
      {isStopping && <TopLoadingBar />}
      {isFormOpen && <SubmitForm initial={review.fields} onClose={() => setIsFormOpen(false)} />}
    </>
  );
}

/** The "Reviewed by" details, checked with zod, then the draft and details go to the admins. */
function SubmitForm({ initial, onClose }: { initial: ReviewerFields; onClose: () => void }) {
  const router = useRouter();
  const [fields, setFields] = useState(initial);
  const [isSending, setIsSending] = useState(false);
  const set = (patch: Partial<ReviewerFields>) => setFields((current) => ({ ...current, ...patch }));

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reviewerSchema.safeParse(fields);
    if (!parsed.success) return void toast.error(parsed.error.issues[0].message);
    const { presentation } = useEditorStore.getState();
    setIsSending(true);
    try {
      await submitReview(presentation, parsed.data);
      toast.success("Thanks! QuizMatter will publish this presentation in 1–2 days.");
      useEditorStore.setState({ savedPresentation: presentation, review: { status: "submitted", note: "", fields: parsed.data } });
      router.push(`/presentation/${presentation.id}`);
    } catch (error) {
      toast.error(saveErrorMessage(error, "submit the review"));
      setIsSending(false);
    }
  };

  return (
    <Modal title="Reviewed by" onClose={onClose} isBusy={isSending}>
      <form onSubmit={send} className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          These show on the presentation once QuizMatter publishes your changes. Teachers keep seeing the old version
          until then.
        </p>
        <Field label="Name">
          <input value={fields.name} onChange={(e) => set({ name: e.target.value })} maxLength={REVIEWER_MAX_LENGTH.name} className={inputClass} />
        </Field>
        <Field label="Email">
          <input type="email" value={fields.email} onChange={(e) => set({ email: e.target.value })} maxLength={REVIEWER_MAX_LENGTH.email} className={inputClass} />
        </Field>
        <Field label="Education or current work">
          <textarea
            value={fields.background}
            onChange={(e) => set({ background: e.target.value })}
            maxLength={REVIEWER_MAX_LENGTH.background}
            rows={4}
            placeholder="e.g. Master Teacher I, Rizal National High School; MA in Mathematics Education"
            className={`${inputClass} resize-y`}
          />
        </Field>
        <Field label="Date reviewed">
          <input type="date" value={fields.reviewedOn} max={todayIso()} onChange={(e) => set({ reviewedOn: e.target.value })} className={inputClass} />
        </Field>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSending}
            className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {isSending && <Spinner size={14} />}
            Submit for publishing
          </button>
        </div>
      </form>
      {isSending && <TopLoadingBar />}
    </Modal>
  );
}

/** Under the top bar: the admin's note after a send-back, or that a submitted review can't change anymore. */
export function ReviewBanner() {
  const review = useEditorStore((s) => s.review);
  if (!review || (review.status === "reviewing" && !review.note)) return null;
  return (
    <p className="shrink-0 border-b border-border-default bg-highlight-soft px-4 py-2 text-sm text-text-primary">
      {review.status === "submitted"
        ? "Submitted. QuizMatter will publish this presentation in 1–2 days. Changes you make now won't be saved."
        : `QuizMatter sent this back: ${review.note}`}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
const secondaryButtonClass =
  "flex items-center gap-2 rounded-button border border-border-default px-3 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60";
```

- [ ] **Step 5: `EditorTopBar.tsx`**
  - Render `<ReviewControls />` between `<SaveButton />` and the Present button.
  - `BackToPresentationsLink`: `const reviewId = useEditorStore((s) => (s.review ? s.presentation.id : null));` → `href={reviewId ? `/presentation/${reviewId}` : fromAdmin ? "/admin/presentations" : "/"}`, `title={reviewId ? "Back to the presentation" : …}`.
  - `SaveButton`: `const review = useEditorStore((s) => s.review);` → `if (review?.status === "submitted") return null;` and labels `hasUnsavedChanges ? (review ? "Save as draft" : "Save") : review ? "Draft saved" : "Saved"`; `title={review ? "Save as draft (Ctrl+S)" : "Save (Ctrl+S)"}`.

- [ ] **Step 6: `DetailsPanel.tsx`**
  - `const isReview = useEditorStore((s) => s.review !== null);`
  - Author: `{isReview ? <Field label="Author"><p className="text-sm text-text-primary">{presentation.author || "—"}</p></Field> : textField("author", …)}`
  - Wrap the Visibility field and the "Shared presentations go to…" note in `{!isReview && (…)}`.
  - Published by: `{isReview ? "QuizMatter" : (publishedBy ?? "—")}`.

- [ ] **Step 7: Check** — `npx tsc --noEmit`, `npm run lint`. Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add "src/app/presentation/[id]/edit" src/components/editor/Editor.tsx src/components/editor/EditorTopBar.tsx src/components/editor/DetailsPanel.tsx src/components/editor/ReviewControls.tsx src/lib/store.ts
git commit -m "Add review mode to the editor: save as draft, submit for publishing, stop review"
```

---

### Task 6: Admin → Presentations: status, open to all, reviews list, review page

**Files:**
- Modify: `src/app/admin/presentations/actions.ts`
- Modify: `src/app/admin/presentations/page.tsx`
- Modify: `src/app/admin/presentations/AdminPresentations.tsx`
- Create: `src/app/admin/presentations/reviews/page.tsx`
- Create: `src/app/admin/presentations/reviews/[id]/page.tsx`
- Create: `src/app/admin/presentations/reviews/[id]/ReviewDecision.tsx`

**Interfaces:**
- Consumes: `publish_review`, `send_back_review`, `set_review_open`, `admin_reviews` (Task 1), `reviewNoteSchema` (Task 2).
- Produces: `publishReview(id): Promise<string | null>`, `sendBackReview(id, note): Promise<string | null>`, `setReviewOpen(id, isOpen): Promise<boolean>`.

- [ ] **Step 1: Server actions in `actions.ts`**

```ts
const reviewOpenSchema = z.object({ id: idSchema, isOpen: z.boolean() });
const sendBackSchema = z.object({ id: idSchema, note: reviewNoteSchema });

/** The "Open to all editors" switch: any editor may start the next review. False if it failed. */
export async function setReviewOpen(id: string, isOpen: boolean): Promise<boolean> {
  const parsed = reviewOpenSchema.safeParse({ id, isOpen });
  if (!parsed.success || !(await getAccount()).isAdmin) return false;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_review_open", { target_id: parsed.data.id, is_open: parsed.data.isOpen });
  refresh();
  return !error;
}

/** Publishes a submitted review: its changes go live and its reviewer is listed. An error message, or null. */
export async function publishReview(id: string): Promise<string | null> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || !(await getAccount()).isAdmin) return "Only admins can publish reviews.";
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_review", { target_id: parsed.data });
  refresh();
  if (error?.code === "QMRVW") return "This review isn't waiting to be published anymore.";
  return error ? "Couldn't publish the review. Please try again." : null;
}

/** Sends a submitted review back to its reviewer with a note. An error message, or null. */
export async function sendBackReview(id: string, note: string): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = sendBackSchema.safeParse({ id, note });
  if (!parsed.success) return parsed.error.issues[0].message;
  if (!(await getAccount()).isAdmin) return "Only admins can send reviews back.";
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_back_review", { target_id: parsed.data.id, note: parsed.data.note });
  refresh();
  if (error?.code === "QMRVW") return "This review isn't waiting to be published anymore.";
  return error ? "Couldn't send the review back. Please try again." : null;
}
```

Also in `setShared`: return value stays boolean; a QMREV refusal shows the same "Couldn't change it" toast — change the toast in `AdminPresentations` to `row.reviewStatus ? "It's under review, so it can't change now." : "Couldn't change it. Please try again."` (the button is disabled anyway while locked).

- [ ] **Step 2: `page.tsx`** — load review rows and the count:

```ts
  const [drafts, { data, error }, reviews] = await Promise.all([
    …,
    supabase.from("presentation_reviews").select("presentation_id, status, open_to_all"),
  ]);
  if (reviews.error) throw reviews.error;
  const reviewById = new Map(reviews.data.map((row) => [row.presentation_id as string, row]));
  const openReviews = reviews.data.filter((row) => row.status === "reviewing" || row.status === "submitted").length;
```

In `buildRows`, saved rows get:

```ts
      // Under review: reviewing or submitted. Locked until an admin publishes it or the reviewer stops.
      reviewStatus: ["reviewing", "submitted"].includes(review?.status) ? (review!.status as "reviewing" | "submitted") : null,
      isOpenToAll: review?.open_to_all === true,
```

(draft rows: `reviewStatus: null, isOpenToAll: false`). Next to `NewPresentationButton` add:

```tsx
        <Link href="/admin/presentations/reviews" className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page">
          <ClipboardCheckIcon size={16} />
          Under review{openReviews > 0 && ` (${openReviews})`}
          <LinkPending />
        </Link>
```

- [ ] **Step 3: `AdminPresentations.tsx`**
  - `AdminPresentationRow` gets `reviewStatus: "reviewing" | "submitted" | null` and `isOpenToAll: boolean`.
  - `COLUMNS` gets one more `120px` column before the share button: `sm:grid-cols-[96px_minmax(0,1fr)_104px_56px_104px_120px_112px_36px]` (status column widened to 104px for "Under review"), and one more empty header `<span className="hidden sm:block" />`.
  - Status pill: `row.reviewStatus` → `"Under review"` with `bg-highlight-soft text-highlight-strong`; otherwise as today.
  - Share button: `disabled={isSharing || isRemoving || row.reviewStatus !== null}`; trash button hidden (`<span />`) while `row.reviewStatus`.
  - New cell before the share button:

```tsx
        {row.isShared && !row.reviewStatus && !isClaudeDraft ? (
          <button
            type="button"
            onClick={toggleOpen}
            disabled={isOpening}
            title="Let any editor start the next review"
            className={`relative z-10 flex items-center justify-center gap-2 rounded-dropdown border px-2.5 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
              row.isOpenToAll ? "border-accent bg-accent-soft text-accent" : "border-border-default bg-bg-surface text-text-primary hover:bg-bg-page"
            }`}
          >
            {isOpening && <Spinner size={12} />}
            {row.isOpenToAll ? "Open to editors" : "Open to all"}
          </button>
        ) : (
          <span className="hidden sm:block" />
        )}
```

with

```tsx
  const [isOpening, startOpening] = useTransition();
  const toggleOpen = () =>
    startOpening(async () => {
      if (!(await setReviewOpen(row.id, !row.isOpenToAll))) toast.error("Couldn't change it. Please try again.");
      else toast.success(row.isOpenToAll ? "Only its last reviewer can review it next." : "Any editor can review it next.");
    });
```

- [ ] **Step 4: `reviews/page.tsx`** (the "Under review" list)

```tsx
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type ReviewRow = {
  presentation_id: string;
  title: string;
  reviewer_name: string;
  status: "reviewing" | "submitted" | "canceled";
  started_at: string;
  submitted_at: string | null;
  ended_at: string | null;
};

const STATUS = {
  submitted: { label: "Waiting for you", className: "bg-highlight-soft text-highlight-strong" },
  reviewing: { label: "Reviewing", className: "bg-accent-soft text-accent" },
  canceled: { label: "Canceled", className: "bg-bg-page text-text-secondary" },
};

/**
 * Admin → Presentations → Under review: every review going on (and canceled ones, until a new review starts).
 * Submitted ones open the review page, to publish or send back. (../../layout.tsx checks the user is an admin.)
 */
export default async function AdminReviewsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reviews");
  if (error) throw error;
  const rows = data as ReviewRow[];
  const now = Date.now();

  return (
    <>
      <Link href="/admin/presentations" className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary">
        <ChevronLeftIcon size={16} />
        Presentations
        <LinkPending />
      </Link>
      <div className="overflow-hidden rounded-card border border-border-default bg-bg-surface">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-text-secondary">No presentations are under review.</p>
        ) : (
          rows.map((row) => {
            const when = row.status === "submitted" ? row.submitted_at : row.status === "canceled" ? row.ended_at : row.started_at;
            const verb = row.status === "submitted" ? "Submitted" : row.status === "canceled" ? "Canceled" : "Started";
            const content = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">{row.title || "Untitled presentation"}</p>
                  <p className="mt-0.5 truncate text-[13px] text-text-secondary">
                    {row.reviewer_name} · {verb} {when ? timeAgo(Date.parse(when), now) : ""}
                  </p>
                </div>
                <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${STATUS[row.status].className}`}>
                  {STATUS[row.status].label}
                </span>
              </>
            );
            const rowClass = "flex min-h-14 items-center gap-4 border-b border-border-default px-5 py-3 last:border-b-0";
            return row.status === "submitted" ? (
              <Link key={row.presentation_id} href={`/admin/presentations/reviews/${row.presentation_id}`} className={`${rowClass} transition-colors hover:bg-bg-page`}>
                {content}
                <LinkPending />
              </Link>
            ) : (
              <div key={row.presentation_id} className={rowClass}>
                {content}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5: `reviews/[id]/page.tsx`** (one submitted review)

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { CANVAS_HEIGHT, CANVAS_WIDTH, getSlideNumbers } from "@/lib/constants";
import { formatDay, joinParts } from "@/lib/format";
import { usesPeopleArt } from "@/lib/peopleArt";
import { presentationSchema, type ReviewerFields } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { ReviewDecision } from "./ReviewDecision";

/** A submitted review: the reviewer's version and details, with Publish and Send back. Admins only (layout). */
export default async function AdminReviewPage({ params }: PageProps<"/admin/presentations/reviews/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("presentation_reviews")
    .select("status, draft, submitted_fields")
    .eq("presentation_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "submitted") notFound();

  const presentation = presentationSchema.parse(data.draft);
  const fields = data.submitted_fields as ReviewerFields;
  const slideNumbers = getSlideNumbers(presentation.slides);
  const details = [
    { label: "Description", value: presentation.description },
    { label: "Curriculum", value: presentation.curriculum },
    { label: "Learning competency", value: presentation.learningCompetency },
    { label: "Tags", value: presentation.tags.join(", ") },
    { label: "References", value: presentation.referenceLinks.join("\n") },
  ].filter((detail) => detail.value);

  return (
    <PeopleArtGate needed={usesPeopleArt(presentation.slides)}>
      <Link href="/admin/presentations/reviews" className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary">
        <ChevronLeftIcon size={16} />
        Under review
        <LinkPending />
      </Link>

      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-text-primary">{presentation.title || "Untitled presentation"}</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {joinParts([presentation.grade, presentation.subject, `${presentation.slides.length} slides`])}
          </p>
        </div>
        <div className="ml-auto">
          <ReviewDecision presentationId={id} />
        </div>
      </header>

      <dl className="mb-6 grid gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-4 text-sm">
        <div>
          <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Reviewed by</dt>
          <dd className="mt-1 text-text-primary">
            <span className="font-semibold">{fields.name}</span>
            <span className="text-text-secondary"> · {fields.email} · {formatDay(fields.reviewedOn)}</span>
            <span className="mt-0.5 block whitespace-pre-line text-text-secondary">{fields.background}</span>
          </dd>
        </div>
        {details.map((detail) => (
          <div key={detail.label}>
            <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{detail.label}</dt>
            <dd className="mt-1 whitespace-pre-line break-words text-text-primary">{detail.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {presentation.slides.map((slide, index) => (
          <div key={slide.id}>
            <div
              className="overflow-hidden rounded-dropdown border border-border-default bg-bg-surface"
              style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
            >
              <FluidSlidePreview slide={slide} questionNumber={slideNumbers.get(slide.id)} />
            </div>
            <span className="mt-1.5 block text-[13px] text-text-secondary">{index + 1}</span>
          </div>
        ))}
      </div>
    </PeopleArtGate>
  );
}
```

- [ ] **Step 6: `reviews/[id]/ReviewDecision.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, UndoIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { REVIEW_NOTE_MAX_LENGTH, reviewNoteSchema } from "@/lib/schema";
import { publishReview, sendBackReview } from "../../actions";

/** Publish (the reviewer's changes go live) or Send back (with a note for the reviewer). */
export function ReviewDecision({ presentationId }: { presentationId: string }) {
  const router = useRouter();
  const [isBusy, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const publish = () => {
    if (!confirm("Publish these changes? Every teacher sees them right away.")) return;
    startTransition(async () => {
      const error = await publishReview(presentationId);
      if (error) return void toast.error(error);
      toast.success("Published. Teachers see the reviewed version now.");
      router.push("/admin/presentations/reviews");
    });
  };

  const sendBack = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reviewNoteSchema.safeParse(note ?? "");
    if (!parsed.success) return void toast.error(parsed.error.issues[0].message);
    startTransition(async () => {
      const error = await sendBackReview(presentationId, parsed.data);
      if (error) return void toast.error(error);
      toast.success("Sent back to the reviewer.");
      router.push("/admin/presentations/reviews");
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setNote("")}
        disabled={isBusy}
        className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
      >
        <UndoIcon size={16} />
        Send back
      </button>
      <button
        type="button"
        onClick={publish}
        disabled={isBusy}
        className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {isBusy && note === null ? <Spinner size={14} /> : <CheckIcon size={16} />}
        Publish
      </button>
      {isBusy && <TopLoadingBar />}

      {note !== null && (
        <Modal title="Send back to the reviewer" onClose={() => setNote(null)} isBusy={isBusy}>
          <form onSubmit={sendBack} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">What should they change?</span>
              <textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={REVIEW_NOTE_MAX_LENGTH}
                rows={4}
                placeholder="e.g. Slide 4's answer is wrong, and please add a reference."
                className="w-full resize-y rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
              />
            </label>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isBusy || !note.trim()}
                className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {isBusy && <Spinner size={14} />}
                Send back
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Check** — `npx tsc --noEmit`, `npm run lint`. Expected: no errors. (`src/app/admin/loading.tsx` already shows the top line and Spinner for these pages.)

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/presentations
git commit -m "Add review status, Open to all editors, and the review list and page to Admin → Presentations"
```

---

### Task 7: Home page "My reviews" row

**Files:**
- Create: `src/app/MyReviews.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `my_reviews()` (Task 1), `Account.isEditor` (Task 2).

- [ ] **Step 1: `MyReviews.tsx`**

```tsx
import Link from "next/link";
import { ClipboardCheckIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";

export type MyReviewRow = { presentation_id: string; title: string; status: "reviewing" | "submitted"; admin_note: string | null };

/** An editor's open reviews, above their presentations. Opening one goes to its page (Continue review is there). */
export function MyReviews({ rows }: { rows: MyReviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-6 rounded-card border border-border-default bg-bg-surface px-5 py-3.5">
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
        <ClipboardCheckIcon size={14} />
        My reviews
      </h2>
      {rows.map((row) => {
        const status =
          row.status === "submitted"
            ? { label: "Waiting for QuizMatter", className: "bg-bg-page text-text-secondary" }
            : row.admin_note
              ? { label: "Sent back", className: "bg-highlight-soft text-highlight-strong" }
              : { label: "Reviewing", className: "bg-accent-soft text-accent" };
        return (
          <Link
            key={row.presentation_id}
            href={`/presentation/${row.presentation_id}`}
            className="-mx-2 flex min-h-12 items-center gap-3 rounded-dropdown px-2 transition-colors hover:bg-bg-page"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{row.title || "Untitled presentation"}</span>
            <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${status.className}`}>{status.label}</span>
            <LinkPending />
          </Link>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 2: `page.tsx`** — after the `Promise.all` (which already has `account`):

```ts
  // An editor's open reviews (see the presentation_reviews migration).
  const myReviews = account.isEditor ? await supabase.rpc("my_reviews") : { data: [], error: null };
  if (myReviews.error) throw myReviews.error;
```

and render `<MyReviews rows={myReviews.data as MyReviewRow[]} />` right above `<PresentationHome …/>` (only when not searching: `{!isSearching && <MyReviews … />}`).

- [ ] **Step 3: Check** — `npx tsc --noEmit`, `npm run lint`. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/MyReviews.tsx src/app/page.tsx
git commit -m "Show an editor's open reviews on the home page"
```

---

### Task 8: Final check

- [ ] **Step 1:** `npx tsc --noEmit` and `npm run lint` on the whole project; fix errors in changed files.
- [ ] **Step 2:** `git diff <commit before Task 1>..HEAD` read next to the spec: every rule (1–10), every field limit, author locked, "Published by" QuizMatter, Canceled in the admin list, toasts on every action, Spinner/top line on every wait, design classes only, zod before every write, no new packages.
- [ ] **Step 3:** Tell the user what passed or failed, that the migration was applied (or that they must apply it), and the things to try live: make an editor, Review, Save as draft, Submit, Send back, Publish, Stop review (Canceled), Open to all.
