-- Plain admin limits (supabase/migrations/20261210000100_plain_admin_limits.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/plain_admin_limits.sql
-- Passes when it ends without an error. Everything is rolled back.
-- A "refused" step passes when the database raises "not allowed" (42501) or changes no row; any other error stops
-- the test.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- b1 super admin, b2 plain admin, b3 teacher, b4 former admin (not in admins, still owns a QuizMatter
-- presentation), b5 editor (reviewer and submitter), b6 teacher who becomes an editor, b7 banned teacher.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000b1', 'pal-super@example.com', '{"first_name": "Pal", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000b2', 'pal-admin@example.com', '{"first_name": "Pal", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000b3', 'pal-teacher@example.com', '{"first_name": "Pal", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000b4', 'pal-former@example.com', '{"first_name": "Pal", "last_name": "Former"}'),
  ('00000000-0000-4000-8000-0000000000b5', 'pal-editor@example.com', '{"first_name": "Pal", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000b6', 'pal-new-editor@example.com', '{"first_name": "Pal", "last_name": "New"}'),
  ('00000000-0000-4000-8000-0000000000b7', 'pal-banned@example.com', '{"first_name": "Pal", "last_name": "Banned"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000000b1', true),
  ('00000000-0000-4000-8000-0000000000b2', false);
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000b5');
insert into public.banned_users (user_id, reason) values ('00000000-0000-4000-8000-0000000000b7', 'Test ban');

-- The teacher's presentations: t1 and t2 get shared below, t4 is for the super admin.
insert into public.presentations (id, owner_id, title) values
  ('test-pal-t1', '00000000-0000-4000-8000-0000000000b3', 'Teacher one'),
  ('test-pal-t2', '00000000-0000-4000-8000-0000000000b3', 'Teacher two'),
  ('test-pal-t4', '00000000-0000-4000-8000-0000000000b3', 'Teacher four');
-- The former admin's QuizMatter presentation.
insert into public.presentations (id, owner_id, title, from_admin) values
  ('test-pal-former', '00000000-0000-4000-8000-0000000000b4', 'Former admin lesson', true);
-- A shared QuizMatter lesson (the super admin's) with a submitted review round by the editor.
insert into public.presentations (id, owner_id, title, from_admin, is_published) values
  ('test-pal-lesson', '00000000-0000-4000-8000-0000000000b1', 'Live lesson', true, true);
-- The editor's own presentation, waiting for QuizMatter.
insert into public.presentations (id, owner_id, title) values
  ('test-pal-sub', '00000000-0000-4000-8000-0000000000b5', 'Editor lesson');
insert into public.slides (presentation_id, id, position, data)
select p.id, 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}'::jsonb
from public.presentations p
where p.id in ('test-pal-t1', 'test-pal-t2', 'test-pal-t4', 'test-pal-former', 'test-pal-lesson', 'test-pal-sub');

insert into public.presentation_reviews (
  presentation_id, reviewer_id, status, draft, draft_updated_at, submitted_fields, started_at, submitted_at
)
values (
  'test-pal-lesson', '00000000-0000-4000-8000-0000000000b5', 'submitted',
  '{
    "id": "test-pal-lesson", "title": "Reviewed lesson", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "QuizMatter", "referenceLinks": [],
    "tags": [], "transition": "slide", "transitionSpeed": 3,
    "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "What is 2 + 2?"}]
  }'::jsonb,
  now(),
  '{"name": "Pal Editor", "email": "pal-editor@example.com", "reviewedOn": "2026-10-24"}'::jsonb,
  now(),
  now()
);
insert into public.presentation_submissions (presentation_id, submitter_id, status, title)
values ('test-pal-sub', '00000000-0000-4000-8000-0000000000b5', 'submitted', 'Editor lesson');

-- ─── As the teacher: publish t1 and t2 (their shared copies, c1 and c2) ───────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b3', 'role', 'authenticated')::text, true);

select public.share_presentation(target_id => 'test-pal-t1');
select public.share_presentation(target_id => 'test-pal-t2');

-- ─── As the plain admin: someone else's presentation ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b2', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  update public.presentations set owner_id = '00000000-0000-4000-8000-0000000000b2' where id = 'test-pal-t1';
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL: a plain admin changed the owner of a teacher''s presentation';
  end if;
exception when insufficient_privilege then
  null;
end $$;

do $$
declare n int;
begin
  update public.presentations set from_admin = true where id = 'test-pal-t1';
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL: a plain admin moved a teacher''s presentation to QuizMatter';
  end if;
exception when insufficient_privilege then
  null;
end $$;

do $$
declare n int;
begin
  update public.presentations set title = 'Taken over' where id = 'test-pal-t1';
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL: a plain admin changed the title of a teacher''s presentation';
  end if;
exception when insufficient_privilege then
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from public.presentations p
    where p.id = 'test-pal-t1' and p.title = 'Teacher one' and not p.from_admin
      and p.owner_id = '00000000-0000-4000-8000-0000000000b3'
  ) then
    raise exception 'FAIL: the teacher''s presentation changed after the refused updates';
  end if;
end $$;

-- Hiding (Admin → Reports) still works, on a teacher's shared copy.
do $$
declare n int;
begin
  update public.presentations set hidden_at = now() where shared_from = 'test-pal-t2';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a plain admin couldn''t hide a teacher''s shared copy';
  end if;
  if not exists (select 1 from public.presentations p where p.shared_from = 'test-pal-t2' and p.hidden_at is not null) then
    raise exception 'FAIL: the hidden copy has no hidden_at';
  end if;
end $$;

-- Neither t1 nor its copy is reported or hidden: nothing is deleted.
do $$
declare n int;
begin
  delete from public.presentations where id = 'test-pal-t1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a plain admin deleted a teacher''s presentation nobody reported or hid';
  end if;
end $$;

-- Giving the editor role is the super admin's.
do $$
declare n int;
begin
  insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000b6');
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL: a plain admin made someone an editor';
  end if;
exception when insufficient_privilege then
  null;
end $$;

-- ─── As the plain admin: everyday work ────────────────────────────────────────────────────────────────────────
-- Their own QuizMatter presentation: saved new, saved again, shared (setShared's update), deleted.
do $$
declare
  saved bigint;
  n int;
begin
  saved := public.save_presentation(
    presentation => '{
      "id": "test-pal-own", "title": "Admin lesson", "description": "", "grades": [], "subject": "", "term": "",
      "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "QuizMatter", "referenceLinks": [],
      "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": true,
      "createdAt": 1790000000000,
      "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "What is 3 + 3?"}]
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => null::bigint
  );
  perform public.save_presentation(
    presentation => '{
      "id": "test-pal-own", "title": "Admin lesson, changed", "description": "", "grades": [], "subject": "",
      "term": "", "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "QuizMatter",
      "referenceLinks": [], "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false,
      "fromAdmin": true, "createdAt": 1790000000000, "slides": []
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => saved
  );
  if not exists (
    select 1 from public.presentations p
    where p.id = 'test-pal-own' and p.title = 'Admin lesson, changed' and p.from_admin
      and p.owner_id = '00000000-0000-4000-8000-0000000000b2'
  ) then
    raise exception 'FAIL: the plain admin''s own QuizMatter presentation wasn''t saved';
  end if;

  update public.presentations set is_published = true where id = 'test-pal-own';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a plain admin couldn''t share their own QuizMatter presentation';
  end if;

  delete from public.presentations where id = 'test-pal-own';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a plain admin couldn''t delete their own presentation';
  end if;
end $$;

-- Publishing a review of the super admin's lesson (publish_review writes it as the database, past the guard).
select public.publish_review(target_id => 'test-pal-lesson');

do $$
begin
  if not exists (select 1 from public.presentations p where p.id = 'test-pal-lesson' and p.title = 'Reviewed lesson') then
    raise exception 'FAIL: publish_review by a plain admin didn''t change the lesson';
  end if;
  if not exists (
    select 1 from public.presentation_reviews r where r.presentation_id = 'test-pal-lesson' and r.status = 'published'
  ) then
    raise exception 'FAIL: publish_review by a plain admin didn''t end the round';
  end if;
end $$;

-- Approving the editor's submission: QuizMatter's copy is the plain admin's.
do $$
declare approved_copy text;
begin
  approved_copy := public.approve_submission(target_id => 'test-pal-sub');
  if not exists (
    select 1 from public.presentations p
    where p.id = approved_copy and p.owner_id = '00000000-0000-4000-8000-0000000000b2' and p.from_admin and p.is_published
  ) then
    raise exception 'FAIL: approve_submission by a plain admin made no QuizMatter copy';
  end if;
end $$;

-- ─── A teacher reports c1 (as postgres) ───────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.presentation_reports (presentation_id, reporter_id, reason)
select p.id, '00000000-0000-4000-8000-0000000000b6', 'spam' from public.presentations p where p.shared_from = 'test-pal-t1';

-- ─── As the plain admin: Reports → Delete (the reported copy's original; the copy goes with it) ───────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b2', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  delete from public.presentations where id = 'test-pal-t1';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a plain admin couldn''t delete a presentation whose shared copy was reported';
  end if;
end $$;

-- ─── As the super admin ───────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  update public.presentations set owner_id = '00000000-0000-4000-8000-0000000000b1' where id = 'test-pal-t4';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the super admin couldn''t change a presentation''s owner';
  end if;
  update public.presentations set from_admin = true where id = 'test-pal-t4';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the super admin couldn''t move a presentation to QuizMatter';
  end if;
end $$;

insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000b6');

do $$
begin
  insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000b2');
  raise exception 'FAIL: an admin was made an editor';
exception when insufficient_privilege then
  if sqlerrm not like 'Admins can''t be editors%' then
    raise exception 'FAIL: making an admin an editor was refused for another reason: %', sqlerrm;
  end if;
end $$;

do $$
begin
  insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000b7');
  raise exception 'FAIL: a banned teacher was made an editor';
exception when insufficient_privilege then
  if sqlerrm not like 'Banned teachers can''t be editors%' then
    raise exception 'FAIL: making a banned teacher an editor was refused for another reason: %', sqlerrm;
  end if;
end $$;

-- ─── As the plain admin: taking the editor role away ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b2', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  delete from public.editors where user_id = '00000000-0000-4000-8000-0000000000b6';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a plain admin couldn''t take the editor role away';
  end if;
end $$;

-- ─── As the former admin ──────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b4', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  delete from public.presentations where id = 'test-pal-former';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a former admin deleted a QuizMatter presentation';
  end if;
end $$;

-- Nor can they make it a normal presentation first, to delete it then.
do $$
declare n int;
begin
  update public.presentations set from_admin = false where id = 'test-pal-former';
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL: a former admin turned from_admin off';
  end if;
exception when insufficient_privilege then
  null;
end $$;

-- ─── As the teacher: a copy of a presentation whose shared copy is hidden ─────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b3', 'role', 'authenticated')::text, true);

-- t3 = "Make a copy" of t2 (its shared copy c2 was hidden above).
select public.save_presentation(
  presentation => '{
    "id": "test-pal-t3", "title": "Copy of Teacher two", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
    "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false, "createdAt": 1790000000000,
    "copiedFrom": "test-pal-t2",
    "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint
);

do $$
begin
  if not exists (select 1 from public.presentations p where p.id = 'test-pal-t3' and p.copied_from = 'test-pal-t2') then
    raise exception 'FAIL: setup: the copy didn''t keep where it was copied from';
  end if;
end $$;

do $$
begin
  perform public.share_presentation(target_id => 'test-pal-t3');
  raise exception 'FAIL: a copy of a presentation whose shared copy is hidden was shared';
exception when insufficient_privilege then
  if sqlerrm not like 'QuizMatter hid the presentation this was copied from%' then
    raise exception 'FAIL: sharing the copy was refused for another reason: %', sqlerrm;
  end if;
end $$;

-- A copy of a presentation nobody hid (the live lesson) still shares.
select public.save_presentation(
  presentation => '{
    "id": "test-pal-t5", "title": "Copy of Reviewed lesson", "description": "", "grades": [], "subject": "",
    "term": "", "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
    "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
    "createdAt": 1790000000000, "copiedFrom": "test-pal-lesson",
    "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "What is 2 + 2?"}]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint
);
select public.share_presentation(target_id => 'test-pal-t5');

-- ─── Final checks (as postgres) ───────────────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if exists (select 1 from public.presentations p where p.id = 'test-pal-t1' or p.shared_from = 'test-pal-t1') then
    raise exception 'FAIL: the reported presentation or its shared copy is still there';
  end if;
  if not exists (select 1 from public.presentations p where p.id = 'test-pal-former' and p.from_admin) then
    raise exception 'FAIL: the former admin''s QuizMatter presentation changed';
  end if;
  if not exists (select 1 from public.presentations p where p.shared_from = 'test-pal-t5') then
    raise exception 'FAIL: the copy of an unhidden presentation has no shared copy';
  end if;
end $$;

rollback;
