-- public_lessons and public_lesson_ids: the newest QuizMatter lessons on the public home page, and every lesson in
-- the sitemap (supabase/migrations/20261231002400_public_lessons.sql). Only published, not hidden QuizMatter
-- lessons; never a teacher's shared copy; the first slide without its answer.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/public_lessons.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- e1 an admin (owns the lessons), e2 a teacher (owns a shared copy).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'pl-admin@example.com', '{"first_name": "Pl", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'pl-teacher@example.com', '{"first_name": "Pl", "last_name": "Teacher"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000e1');

-- l1 older, l2 newer (its first slide carries answers), l3 a lesson an admin will hide, l4 a lesson still a draft.
insert into public.presentations (id, owner_id, title, subject, grades, is_published, from_admin, updated_at) values
  ('test-pl-1', '00000000-0000-4000-8000-0000000000e1', 'Older lesson', 'Math', '{"Grade 1"}', true, true, now() - interval '2 days'),
  ('test-pl-2', '00000000-0000-4000-8000-0000000000e1', 'Newer lesson', 'Science', '{}', true, true, now() - interval '1 day'),
  ('test-pl-3', '00000000-0000-4000-8000-0000000000e1', 'Hidden lesson', '', '{}', true, true, now()),
  ('test-pl-4', '00000000-0000-4000-8000-0000000000e1', 'Draft lesson', '', '{}', false, true, now());
insert into public.slides (presentation_id, id, position, data) values
  ('test-pl-1', 'a1', 0, '{"id": "a1", "type": "blank", "elements": [], "question": "One"}'),
  ('test-pl-2', 'b1', 0, '{"id": "b1", "type": "short-answer", "question": "Two", "correctOptionId": "o1",
    "correctAnswer": "Secret", "elements": [{"id": "q1", "containerId": null}, {"id": "ans", "containerId": "answer"}]}'),
  ('test-pl-3', 'c1', 0, '{"id": "c1", "type": "blank", "elements": [], "question": "Three"}'),
  ('test-pl-4', 'd1', 0, '{"id": "d1", "type": "blank", "elements": [], "question": "Four"}');

-- A teacher's shared copy (published, not a QuizMatter lesson): never listed.
select set_config('quizmatter.sharing', 'yes', true);
insert into public.presentations (id, owner_id, title) values ('test-pl-o5', '00000000-0000-4000-8000-0000000000e2', 'Original');
insert into public.presentations (id, owner_id, title, is_published, shared_from, shared_at) values
  ('test-pl-5', '00000000-0000-4000-8000-0000000000e2', 'Teacher copy', true, 'test-pl-o5', now());
select set_config('quizmatter.sharing', '', true);

-- The admin hides l3.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
update public.presentations set hidden_at = now() where id = 'test-pl-3';
reset role;

-- ─── As a logged-out visitor ──────────────────────────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

do $$
declare
  ids text;
  slide jsonb;
begin
  -- Other lessons may exist in the database; only ours are checked, in order.
  select string_agg(id, ',' order by n) into ids
  from public.public_lessons(50) with ordinality as x (id, title, subject, grades, updated_at, first_slide, n)
  where id like 'test-pl-%';
  if ids is distinct from 'test-pl-2,test-pl-1' then
    raise exception 'FAIL: public_lessons should give the published, not hidden lessons, newest first, got %', ids;
  end if;

  select first_slide into slide from public.public_lessons(50) where id = 'test-pl-2';
  if slide -> 'correctOptionId' is distinct from 'null'::jsonb or slide ? 'correctAnswer'
     or (select string_agg(e ->> 'id', ',') from jsonb_array_elements(slide -> 'elements') e) is distinct from 'q1' then
    raise exception 'FAIL: a lesson''s first slide still carries its answer: %', slide;
  end if;

  if (select count(*) from public.public_lessons(1)) <> 1 then
    raise exception 'FAIL: public_lessons(1) should give one lesson';
  end if;

  begin
    perform public.public_lessons(0);
    raise exception 'FAIL: public_lessons(0) should be refused';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.public_lessons(51);
    raise exception 'FAIL: public_lessons(51) should be refused';
  exception when sqlstate '22023' then null;
  end;

  select string_agg(id, ',' order by updated_at desc) into ids from public.public_lesson_ids() where id like 'test-pl-%';
  if ids is distinct from 'test-pl-2,test-pl-1' then
    raise exception 'FAIL: public_lesson_ids should list the same lessons, got %', ids;
  end if;

  -- The slide data comes back cleaned by the one shared rule: public_presentation agrees.
  if (select first_slide from public.public_presentation('test-pl-2')) is distinct from slide then
    raise exception 'FAIL: public_presentation and public_lessons clean the first slide differently';
  end if;
end $$;

-- The tables stay closed to anon.
do $$
begin
  begin
    perform 1 from public.presentations limit 1;
    raise exception 'FAIL: anon may read presentations directly';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
