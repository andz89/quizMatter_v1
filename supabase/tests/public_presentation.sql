-- public_presentation: the one read a logged-out visitor (anon) may make, for a published presentation's public
-- preview page and its link picture (supabase/migrations/20261231002200_public_presentation.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/public_presentation.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- e1 a teacher (display name "Pp Teacher"), e2 an admin, e3 another teacher who looks.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'pp-teacher@example.com', '{"first_name": "Pp", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'pp-admin@example.com', '{"first_name": "Pp", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'pp-viewer@example.com', '{"first_name": "Pp", "last_name": "Viewer"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000e2');

-- p1 published, no Author, first slide hidden. p2 published with an Author. p3 published, every slide hidden.
-- p4 a QuizMatter lesson with no Author. p5 private. p6 published but hidden by an admin.
-- A teacher's published one is always a shared copy of a private original (the database refuses anything else);
-- the flag share_presentation sets lets the setup write copies directly.
select set_config('quizmatter.sharing', 'yes', true);
insert into public.presentations (id, owner_id, title) values
  ('test-pp-o1', '00000000-0000-4000-8000-0000000000e1', 'Original 1'),
  ('test-pp-o2', '00000000-0000-4000-8000-0000000000e1', 'Original 2'),
  ('test-pp-o3', '00000000-0000-4000-8000-0000000000e1', 'Original 3'),
  ('test-pp-o6', '00000000-0000-4000-8000-0000000000e1', 'Original 6');
insert into public.presentations (id, owner_id, title, description, subject, grades, author, is_published, from_admin, hidden_at, shared_from, shared_at) values
  ('test-pp-1', '00000000-0000-4000-8000-0000000000e1', 'Fractions', 'Halves and quarters', 'Math', '{"4","5"}', '', true, false, null, 'test-pp-o1', now()),
  ('test-pp-2', '00000000-0000-4000-8000-0000000000e1', 'Verbs', '', 'English', '{}', 'Ma. Santos', true, false, null, 'test-pp-o2', now()),
  ('test-pp-3', '00000000-0000-4000-8000-0000000000e1', 'All hidden', '', '', '{}', '', true, false, null, 'test-pp-o3', now()),
  ('test-pp-4', '00000000-0000-4000-8000-0000000000e2', 'Lesson', '', '', '{}', '', true, true, null, null, null),
  ('test-pp-5', '00000000-0000-4000-8000-0000000000e1', 'Private', '', '', '{}', '', false, false, null, null, null),
  ('test-pp-6', '00000000-0000-4000-8000-0000000000e1', 'Moderated', '', '', '{}', '', true, false, null, 'test-pp-o6', now());
insert into public.slides (presentation_id, id, position, data) values
  ('test-pp-1', 'a1', 0, '{"id": "a1", "type": "blank", "elements": [], "question": "Hidden one", "hidden": true}'),
  ('test-pp-1', 'a2', 1, '{"id": "a2", "type": "blank", "elements": [], "question": "First shown"}'),
  ('test-pp-1', 'a3', 2, '{"id": "a3", "type": "blank", "elements": [], "question": "Second shown"}'),
  ('test-pp-2', 'b1', 0, '{"id": "b1", "type": "short-answer", "question": "Run", "correctOptionId": "o2",
    "correctAnswer": "Tumakbo", "answerType": "canvas", "elements": [
      {"id": "q1", "assetId": "star", "containerId": null},
      {"id": "ans1", "assetId": "check", "containerId": "answer"}]}'),
  ('test-pp-3', 'c1', 0, '{"id": "c1", "type": "blank", "elements": [], "question": "One", "hidden": true}'),
  ('test-pp-3', 'c2', 1, '{"id": "c2", "type": "blank", "elements": [], "question": "Two", "hidden": true}'),
  ('test-pp-4', 'd1', 0, '{"id": "d1", "type": "blank", "elements": [], "question": "Lesson"}'),
  ('test-pp-5', 'e1', 0, '{"id": "e1", "type": "blank", "elements": [], "question": "Private"}'),
  ('test-pp-6', 'f1', 0, '{"id": "f1", "type": "blank", "elements": [], "question": "Moderated"}');

select set_config('quizmatter.sharing', '', true);

-- The admin hides p6 (as Admin → Reports does).
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated', 'aal', 'aal2')::text, true);
update public.presentations set hidden_at = now() where id = 'test-pp-6';
reset role;

-- ─── As a logged-out visitor ──────────────────────────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

do $$
declare
  r record;
begin
  select * into r from public.public_presentation('test-pp-1');
  if r.title is distinct from 'Fractions' or r.description is distinct from 'Halves and quarters'
     or r.subject is distinct from 'Math' or r.grades is distinct from '{"4","5"}'::text[] or r.from_admin then
    raise exception 'FAIL: p1 details are wrong: %', row_to_json(r);
  end if;
  -- A teacher's display name is usually their full name: never on the open web.
  if r.author_name is distinct from '' then
    raise exception 'FAIL: with no Author, no name should show (not the display name), got %', r.author_name;
  end if;
  if r.slide_count is distinct from 2 then
    raise exception 'FAIL: p1 should count its 2 shown slides, got %', r.slide_count;
  end if;
  if r.first_slide ->> 'id' is distinct from 'a2' then
    raise exception 'FAIL: p1 first slide should be the first shown one (a2), got %', r.first_slide ->> 'id';
  end if;

  select * into r from public.public_presentation('test-pp-2');
  if r.author_name is distinct from 'Ma. Santos' then
    raise exception 'FAIL: the Author text should win, got %', r.author_name;
  end if;
  -- No answers: anyone can call this with the public key.
  if r.first_slide -> 'correctOptionId' is distinct from 'null'::jsonb or r.first_slide ? 'correctAnswer' then
    raise exception 'FAIL: the first slide still carries its answer: %', r.first_slide;
  end if;
  if (select string_agg(e ->> 'id', ',') from jsonb_array_elements(r.first_slide -> 'elements') e) is distinct from 'q1' then
    raise exception 'FAIL: the answer box''s pictures should be left out, the rest kept: %', r.first_slide -> 'elements';
  end if;
  if r.first_slide ->> 'question' is distinct from 'Run' then
    raise exception 'FAIL: the rest of the slide should stay';
  end if;

  select * into r from public.public_presentation('test-pp-3');
  if r.slide_count is distinct from 2 or r.first_slide ->> 'id' is distinct from 'c1' then
    raise exception 'FAIL: with every slide hidden, all count and the first shows (like shownSlides), got % / %',
      r.slide_count, r.first_slide ->> 'id';
  end if;

  select * into r from public.public_presentation('test-pp-4');
  if r.author_name is distinct from 'QuizMatter' or not r.from_admin then
    raise exception 'FAIL: a QuizMatter lesson with no Author should say QuizMatter, got %', r.author_name;
  end if;

  if exists (select 1 from public.public_presentation('test-pp-5')) then
    raise exception 'FAIL: a private presentation was readable';
  end if;
  if exists (select 1 from public.public_presentation('test-pp-6')) then
    raise exception 'FAIL: a hidden (moderated) presentation was readable';
  end if;
  if exists (select 1 from public.public_presentation('nope')) then
    raise exception 'FAIL: an unknown id gave a row';
  end if;

  -- Only these columns: nothing about the owner, reviews or submissions.
  if (select string_agg(column_name, ',' order by column_name) from (
        select (jsonb_each(to_jsonb(x))).key as column_name from public.public_presentation('test-pp-1') x) k)
     is distinct from 'author_name,description,first_slide,from_admin,grades,slide_count,subject,title' then
    raise exception 'FAIL: public_presentation returns other columns';
  end if;
end $$;

-- The tables themselves stay closed to anon.
do $$
begin
  begin
    perform 1 from public.presentations limit 1;
    raise exception 'FAIL: anon may read presentations directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.slides limit 1;
    raise exception 'FAIL: anon may read slides directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ─── As another logged-in teacher: the same answer ──────────────────────────────────────────────────────────
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e3', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
begin
  if (select title from public.public_presentation('test-pp-1')) is distinct from 'Fractions' then
    raise exception 'FAIL: a logged-in teacher should get the same row';
  end if;
end $$;

rollback;
