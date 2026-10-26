-- Admin overview counts (supabase/migrations/20261210000500_admin_overview_counts.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/admin_overview_counts.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- f1 super admin, f2 and f3 editors, f4 teacher. Three shared QuizMatter lessons to review.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f1', 'aoc-super@example.com', '{"first_name": "Aoc", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'aoc-editor@example.com', '{"first_name": "Aoc", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'aoc-other@example.com', '{"first_name": "Aoc", "last_name": "Other"}'),
  ('00000000-0000-4000-8000-0000000000f4', 'aoc-teacher@example.com', '{"first_name": "Aoc", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000f1', true);
insert into public.editors (user_id) values
  ('00000000-0000-4000-8000-0000000000f2'),
  ('00000000-0000-4000-8000-0000000000f3');

insert into public.presentations (id, owner_id, title, from_admin, is_published) values
  ('test-aoc-l1', '00000000-0000-4000-8000-0000000000f1', 'Lesson one', true, true),
  ('test-aoc-l2', '00000000-0000-4000-8000-0000000000f1', 'Lesson two', true, true),
  ('test-aoc-l3', '00000000-0000-4000-8000-0000000000f1', 'Lesson three', true, true);
-- The editor f2's own presentation (one shared copy would not count, so none is made).
insert into public.presentations (id, owner_id, title) values
  ('test-aoc-own', '00000000-0000-4000-8000-0000000000f2', 'Editor lesson');
insert into public.slides (presentation_id, id, position, data)
select p.id, 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}'::jsonb
from public.presentations p
where p.id like 'test-aoc-%';

-- f2 uploaded two photos and has one published review.
insert into public.photos (user_id, src, width, height) values
  ('00000000-0000-4000-8000-0000000000f2', 'https://images.quizmatter.com/uploads/test-aoc-1.webp', 10, 10),
  ('00000000-0000-4000-8000-0000000000f2', 'https://images.quizmatter.com/uploads/test-aoc-2.webp', 10, 10);
insert into public.presentation_reviewers (presentation_id, reviewer_id, name, email, reviewed_on) values
  ('test-aoc-l3', '00000000-0000-4000-8000-0000000000f2', 'Aoc Editor', 'aoc-editor@example.com', '2026-10-20');

-- Before anything happens: how many reviews today's bar already has (0 on a fresh database).
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);
select set_config('test.reviews_before', coalesce((
  select o.total from public.admin_overview(7) o
  where o.series = 'reviews' and o.day = (now() at time zone 'utc')::date
), 0)::text, true);

-- ─── 1. A round submitted, then sent back, is still counted as submitted (once) ───────────────────────────────
-- As the editor f2: start a review of lesson one and submit it.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);

select public.start_review(target_id => 'test-aoc-l1');
select public.submit_review(
  target_id => 'test-aoc-l1',
  review_draft => '{"id": "test-aoc-l1", "title": "Lesson one", "slides": [{"id": "s1", "type": "blank"}]}',
  reviewed_on => current_date,
  base_updated_at => null::bigint
);

-- As the super admin: send it back.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);

select public.send_back_review(target_id => 'test-aoc-l1', note => 'Please fix slide 1.');

do $$
declare n int;
begin
  select coalesce(sum(o.total), 0) into n from public.admin_overview(7) o
  where o.series = 'reviews' and o.day = (now() at time zone 'utc')::date;
  if n <> current_setting('test.reviews_before')::int + 1 then
    raise exception 'FAIL: a round sent back is not counted as submitted (today''s Reviews submitted: %)', n;
  end if;
end $$;

-- As the editor f2: submit it again (the draft was saved at the first submit, so pass its time).
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);

select public.submit_review(
  target_id => 'test-aoc-l1',
  review_draft => '{"id": "test-aoc-l1", "title": "Lesson one, fixed", "slides": [{"id": "s1", "type": "blank"}]}',
  reviewed_on => current_date,
  base_updated_at => (
    select floor(extract(epoch from r.draft_updated_at) * 1000)::bigint
    from public.presentation_reviews r where r.presentation_id = 'test-aoc-l1'
  )
);

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  select coalesce(sum(o.total), 0) into n from public.admin_overview(7) o
  where o.series = 'reviews' and o.day = (now() at time zone 'utc')::date;
  if n <> current_setting('test.reviews_before')::int + 1 then
    raise exception 'FAIL: a round submitted twice (after a send-back) is not counted once (today: %)', n;
  end if;
end $$;

-- ─── 2. A round canceled after its submit still counts; a new round counts only once submitted ────────────────
-- As the editor f3: start a review of lesson two and submit it. The super admin cancels it.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f3', 'role', 'authenticated')::text, true);

select public.start_review(target_id => 'test-aoc-l2');
select public.submit_review(
  target_id => 'test-aoc-l2',
  review_draft => '{"id": "test-aoc-l2", "title": "Lesson two", "slides": [{"id": "s1", "type": "blank"}]}',
  reviewed_on => current_date,
  base_updated_at => null::bigint
);

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);

select public.admin_cancel_review(target_id => 'test-aoc-l2');

do $$
declare n int;
begin
  select coalesce(sum(o.total), 0) into n from public.admin_overview(7) o
  where o.series = 'reviews' and o.day = (now() at time zone 'utc')::date;
  if n <> current_setting('test.reviews_before')::int + 2 then
    raise exception 'FAIL: a round canceled after its submit is not counted as submitted (today: %)', n;
  end if;
end $$;

-- As the editor f3: start a new round of lesson two. It replaces the canceled one and isn't submitted yet.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f3', 'role', 'authenticated')::text, true);

select public.start_review(target_id => 'test-aoc-l2');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  select coalesce(sum(o.total), 0) into n from public.admin_overview(7) o
  where o.series = 'reviews' and o.day = (now() at time zone 'utc')::date;
  if n <> current_setting('test.reviews_before')::int + 1 then
    raise exception 'FAIL: a new round that isn''t submitted yet is counted as submitted (today: %)', n;
  end if;
end $$;

-- ─── 3. "Under review": the menu and the Presentations page count the rounds waiting for an admin ─────────────
-- Both show admin_todo_counts().reviews (one call per page, src/app/admin/todoCounts.ts). It must be the rounds the
-- Under review list marks "Waiting for you" (admin_reviews() rows with status submitted), not the ones still being
-- reviewed. Now: lesson one is submitted, lesson two is being reviewed; lesson three starts being reviewed too.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);

select public.start_review(target_id => 'test-aoc-l3');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);

do $$
declare
  menu int := (select c.reviews from public.admin_todo_counts() c);
  waiting int := (select count(*) from public.admin_reviews() r where r.status = 'submitted');
  open_rounds int := (select count(*) from public.admin_reviews() r where r.status in ('reviewing', 'submitted'));
begin
  if waiting <> 1 or open_rounds <> 3 then
    raise exception 'FAIL: setup: % rounds waiting and % open, not 1 and 3', waiting, open_rounds;
  end if;
  if menu <> waiting then
    raise exception 'FAIL: Under review counts % rounds, but % are waiting for an admin', menu, waiting;
  end if;
end $$;

-- ─── 4. admin_editors: Admin → Editors' numbers, counted in the database ──────────────────────────────────────
do $$
declare
  editor record;
begin
  select * into editor from public.admin_editors() e where e.user_id = '00000000-0000-4000-8000-0000000000f2';
  if not found then
    raise exception 'FAIL: admin_editors() leaves out the editor';
  end if;
  -- The page reads each editor's email here, not one account at a time.
  if editor.email is distinct from 'aoc-editor@example.com' then
    raise exception 'FAIL: admin_editors() gives the email %, not aoc-editor@example.com', editor.email;
  end if;
  if editor.presentations <> 1 or editor.photos <> 2 or editor.published_reviews <> 1
    or editor.last_review is distinct from '2026-10-20'::date then
    raise exception 'FAIL: admin_editors() counts % presentations, % photos, % reviews (last %), not 1, 2, 1 (2026-10-20)',
      editor.presentations, editor.photos, editor.published_reviews, editor.last_review;
  end if;
  if (select count(*) from public.admin_editors() e where e.user_id::text like '00000000-0000-4000-8000-0000000000f%')
    <> 2 then
    raise exception 'FAIL: admin_editors() doesn''t list exactly the 2 test editors';
  end if;
end $$;

-- A teacher (not an admin) gets no rows, so no emails either.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f4', 'role', 'authenticated')::text, true);

do $$
begin
  if exists (select 1 from public.admin_editors()) then
    raise exception 'FAIL: a teacher can read admin_editors()';
  end if;
end $$;

-- Nor does an editor.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);

do $$
begin
  if exists (select 1 from public.admin_editors()) then
    raise exception 'FAIL: an editor can read admin_editors()';
  end if;
end $$;

rollback;
