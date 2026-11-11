-- Moderation fixes (supabase/migrations/20261231000900_moderation_fixes.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/moderation_fixes.sql
-- Passes when it ends without an error. Everything is rolled back.
-- 1. A plain admin hides or shows only a teacher's shared copy, never a QuizMatter lesson or a private presentation.
-- 2. A plain admin deletes someone else's presentation only when its teacher's shared copy is hidden or reported:
--    a report they add on a QuizMatter lesson or a private presentation doesn't open the delete.
-- 3. Banning an editor takes the role away, which cancels their open review round.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- c1 super admin, c2 plain admin, c3 teacher, c4 editor.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', 'mod-super@example.com', '{"first_name": "Mod", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'mod-admin@example.com', '{"first_name": "Mod", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'mod-teacher@example.com', '{"first_name": "Mod", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000c4', 'mod-editor@example.com', '{"first_name": "Mod", "last_name": "Editor"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000000c1', true),
  ('00000000-0000-4000-8000-0000000000c2', false);
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000c4');

-- The super admin's live QuizMatter lessons (the first one gets a review round below), the teacher's private one
-- (p1) and the one they publish (p2).
insert into public.presentations (id, owner_id, title, from_admin, is_published) values
  ('test-mod-lesson', '00000000-0000-4000-8000-0000000000c1', 'Live lesson', true, true),
  ('test-mod-lesson2', '00000000-0000-4000-8000-0000000000c1', 'Second lesson', true, true);
insert into public.presentations (id, owner_id, title) values
  ('test-mod-p1', '00000000-0000-4000-8000-0000000000c3', 'Private one'),
  ('test-mod-p2', '00000000-0000-4000-8000-0000000000c3', 'Published one');
insert into public.slides (presentation_id, id, position, data)
select p.id, 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}'::jsonb
from public.presentations p
where p.id in ('test-mod-lesson', 'test-mod-lesson2', 'test-mod-p1', 'test-mod-p2');

-- The editor is reviewing the lesson.
insert into public.presentation_reviews (presentation_id, reviewer_id, status, started_at)
values ('test-mod-lesson', '00000000-0000-4000-8000-0000000000c4', 'reviewing', now());

-- ─── As the teacher: publish p2 (its shared copy) ─────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c3', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.share_presentation(target_id => 'test-mod-p2');

-- ─── As the plain admin ───────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c2', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- 1. Hiding the super admin's QuizMatter lesson is refused.
do $$
declare n int;
begin
  update public.presentations set hidden_at = now() where id = 'test-mod-lesson';
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL: a plain admin hid a QuizMatter lesson';
  end if;
exception when insufficient_privilege then
  null;
end $$;

-- 1. Hiding a teacher's private presentation is refused.
do $$
declare n int;
begin
  update public.presentations set hidden_at = now() where id = 'test-mod-p1';
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL: a plain admin hid a teacher''s private presentation';
  end if;
exception when insufficient_privilege then
  null;
end $$;

-- 2. A report they add themselves doesn't let them delete a QuizMatter lesson or a private presentation.
insert into public.presentation_reports (presentation_id, reporter_id, reason) values
  ('test-mod-lesson2', '00000000-0000-4000-8000-0000000000c2', 'spam'),
  ('test-mod-p1', '00000000-0000-4000-8000-0000000000c2', 'spam');

do $$
declare n int;
begin
  delete from public.presentations where id = 'test-mod-lesson2';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a plain admin deleted the super admin''s QuizMatter lesson';
  end if;
exception when insufficient_privilege then
  null;
end $$;

do $$
declare n int;
begin
  delete from public.presentations where id = 'test-mod-p1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a plain admin deleted a teacher''s private presentation';
  end if;
exception when insufficient_privilege then
  null;
end $$;

-- Still allowed: hide a teacher's shared copy, then delete its original (Reports → Delete).
do $$
declare n int;
begin
  update public.presentations set hidden_at = now() where shared_from = 'test-mod-p2';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a plain admin couldn''t hide a teacher''s shared copy';
  end if;
  update public.presentations set hidden_at = null where shared_from = 'test-mod-p2';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a plain admin couldn''t show a teacher''s shared copy again';
  end if;
  update public.presentations set hidden_at = now() where shared_from = 'test-mod-p2';
  delete from public.presentations where id = 'test-mod-p2';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a plain admin couldn''t delete a presentation whose shared copy is hidden';
  end if;
end $$;

-- ─── As the super admin ───────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- The super admin still hides anything.
do $$
declare n int;
begin
  update public.presentations set hidden_at = now() where id = 'test-mod-p1';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the super admin couldn''t hide a presentation';
  end if;
end $$;

-- 3. Banning the editor.
insert into public.banned_users (user_id, reason) values ('00000000-0000-4000-8000-0000000000c4', 'Test ban');

-- ─── Final checks (as postgres) ───────────────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if not exists (select 1 from public.presentations p where p.id = 'test-mod-lesson' and p.hidden_at is null) then
    raise exception 'FAIL: the QuizMatter lesson is gone or hidden';
  end if;
  if not exists (select 1 from public.presentations p where p.id = 'test-mod-lesson2') then
    raise exception 'FAIL: the second QuizMatter lesson is gone';
  end if;
  if exists (select 1 from public.presentations p where p.id = 'test-mod-p2' or p.shared_from = 'test-mod-p2') then
    raise exception 'FAIL: the hidden presentation or its shared copy is still there';
  end if;
  if exists (select 1 from public.editors e where e.user_id = '00000000-0000-4000-8000-0000000000c4') then
    raise exception 'FAIL: the banned editor is still an editor';
  end if;
  if exists (
    select 1 from public.presentation_reviews r
    where r.presentation_id = 'test-mod-lesson' and r.status in ('reviewing', 'submitted')
  ) then
    raise exception 'FAIL: the banned editor''s review round is still open';
  end if;
  if public.is_review_locked('test-mod-lesson') then
    raise exception 'FAIL: the lesson is still locked after the editor was banned';
  end if;
end $$;

rollback;
