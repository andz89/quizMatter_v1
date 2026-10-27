-- Deleting accounts the way Supabase does it (supabase/migrations/20261210000300_direct_write_limits.sql, section 7).
-- The dashboard's "Delete user" and the Auth API delete as the role supabase_auth_admin, and the rows the account
-- owns go with it ("on delete cascade"), firing their tables' triggers. Nothing may stop it.
-- Run on a local database with every migration applied, as supabase_admin (only it may switch to
-- supabase_auth_admin):
--   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/account_delete.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup ────────────────────────────────────────────────────────────────────────────────────────────────────
-- g1 super admin (stays), g2 plain admin (owns a QuizMatter presentation and a shared photo), g3 teacher (owns a
-- bit of everything), g4 editor (an approved and a waiting submission, a review round, a "Reviewed by" row).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'acd-super@example.com', '{"first_name": "Acd", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'acd-admin@example.com', '{"first_name": "Acd", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000a3', 'acd-teacher@example.com', '{"first_name": "Acd", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000a4', 'acd-editor@example.com', '{"first_name": "Acd", "last_name": "Editor"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000000a1', true),
  ('00000000-0000-4000-8000-0000000000a2', false);
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000a4');

insert into public.presentations (id, owner_id, title, from_admin, is_published) values
  ('test-acd-lesson', '00000000-0000-4000-8000-0000000000a1', 'Live lesson', true, true),
  ('test-acd-admin', '00000000-0000-4000-8000-0000000000a2', 'Admin lesson', true, true);
insert into public.presentations (id, owner_id, title) values
  ('test-acd-t1', '00000000-0000-4000-8000-0000000000a3', 'Teacher one'),
  ('test-acd-t2', '00000000-0000-4000-8000-0000000000a3', 'Teacher two'),
  ('test-acd-e1', '00000000-0000-4000-8000-0000000000a4', 'Editor approved'),
  ('test-acd-e2', '00000000-0000-4000-8000-0000000000a4', 'Editor waiting');
-- Every presentation gets a slide; the teacher's first one shows a photo (so slide_photos has a row).
insert into public.slides (presentation_id, id, position, data)
select p.id, 's1', 0, jsonb_build_object(
  'id', 's1', 'type', 'blank', 'question', 'What is 1 + 1?',
  'elements', case when p.id = 'test-acd-t1'
    then jsonb_build_array(jsonb_build_object('src', 'https://images.quizmatter.com/uploads/' || repeat('a', 64) || '.webp'))
    else '[]'::jsonb end
)
from public.presentations p
where p.id like 'test-acd-%';

insert into public.presentation_submissions (presentation_id, submitter_id, status, title) values
  ('test-acd-e1', '00000000-0000-4000-8000-0000000000a4', 'submitted', 'Editor approved'),
  ('test-acd-e2', '00000000-0000-4000-8000-0000000000a4', 'submitted', 'Editor waiting');
insert into public.presentation_reviewers (presentation_id, reviewer_id, name, email, reviewed_on)
values ('test-acd-lesson', '00000000-0000-4000-8000-0000000000a4', 'Acd Editor', 'acd-editor@example.com', '2026-10-24');

insert into public.photo_categories (name) values ('Test acd photos');
insert into public.shared_photos (src, width, height, category_id, uploaded_by)
select 'https://images.quizmatter.com/uploads/' || repeat('b', 64) || '.webp', 10, 10, c.id,
  '00000000-0000-4000-8000-0000000000a2'
from public.photo_categories c
where c.name = 'Test acd photos';

-- As the teacher, through the app's own paths: publish, file, add a photo, report, like, save, settings.
-- A new request starts with the "already counted" flag empty.
select set_config('quizmatter.write_counted', '', true);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000a3', 'role', 'authenticated')::text, true);

select public.share_presentation(target_id => 'test-acd-t1');
insert into public.folders (id, name) values ('00000000-0000-4000-8000-0000000000fa', 'Week 1');
insert into public.folder_items (presentation_id, folder_id) values ('test-acd-t2', '00000000-0000-4000-8000-0000000000fa');
insert into public.photos (src, width, height)
values ('https://images.quizmatter.com/uploads/' || repeat('a', 64) || '.webp', 10, 10);
insert into public.presentation_reports (presentation_id, reason) values ('test-acd-lesson', 'spam');
select public.set_liked(presentation_id => 'test-acd-lesson', is_liked => true);
select public.set_saved(presentation_id => 'test-acd-lesson', is_saved => true);
update public.user_settings set favorite_element_categories = '{}' where user_id = '00000000-0000-4000-8000-0000000000a3';

-- As the editor: a review round on the lesson.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000a4', 'role', 'authenticated')::text, true);

select public.start_review(target_id => 'test-acd-lesson');

-- As the super admin: approve the editor's first submission (QuizMatter's copy is the super admin's).
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

select public.approve_submission(target_id => 'test-acd-e1');

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (select count(*) from public.presentations p where p.owner_id = '00000000-0000-4000-8000-0000000000a3') <> 3
    or not exists (select 1 from public.slide_photos sp where sp.presentation_id = 'test-acd-t1')
    or not exists (select 1 from public.presentation_likes l where l.user_id = '00000000-0000-4000-8000-0000000000a3')
    or not exists (select 1 from public.click_rate c where c.user_id = '00000000-0000-4000-8000-0000000000a3')
    or not exists (select 1 from public.presentation_reviews r where r.reviewer_id = '00000000-0000-4000-8000-0000000000a4')
    or not exists (
      select 1 from public.presentation_submissions s
      where s.presentation_id = 'test-acd-e1' and s.status = 'approved' and s.copy_id is not null
    ) then
    raise exception 'FAIL: setup: the accounts don''t own what the test deletes';
  end if;
  -- The write counter still counts a logged-in teacher (their publish wrote presentations).
  if (select r.clicks from public.click_rate r
      where r.user_id = '00000000-0000-4000-8000-0000000000a3' and r.feature = 'presentation_save') is distinct from 1 then
    raise exception 'FAIL: the teacher''s presentation write wasn''t counted';
  end if;
end $$;

-- ─── Delete the three accounts as Supabase Auth does ─────────────────────────────────────────────────────────
set local role supabase_auth_admin;

do $$
declare
  account uuid;
  failures text := '';
begin
  foreach account in array array[
    '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a2'
  ]::uuid[] loop
    -- Each delete is its own request in real life: the "already counted / logged" flags start empty.
    perform set_config('quizmatter.write_counted', '', true);
    perform set_config('quizmatter.admin_logged', '', true);
    begin
      delete from auth.users where id = account;
    exception when others then
      failures := failures || format(E'\n  account %s: %s (%s)', account, sqlerrm, sqlstate);
    end;
  end loop;
  if failures <> '' then
    raise exception 'FAIL: Supabase Auth couldn''t delete an account:%', failures;
  end if;
end $$;

reset role;

-- ─── What's left ──────────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  -- The teacher's own things are gone.
  if exists (select 1 from public.presentations p where p.owner_id = '00000000-0000-4000-8000-0000000000a3')
    or exists (select 1 from public.presentations p where p.id in ('test-acd-t1', 'test-acd-t2'))
    or exists (select 1 from public.folders f where f.owner_id = '00000000-0000-4000-8000-0000000000a3')
    or exists (select 1 from public.photos ph where ph.user_id = '00000000-0000-4000-8000-0000000000a3')
    or exists (select 1 from public.presentation_reports r where r.reporter_id = '00000000-0000-4000-8000-0000000000a3')
    or exists (select 1 from public.presentation_likes l where l.user_id = '00000000-0000-4000-8000-0000000000a3')
    or exists (select 1 from public.saved_presentations s where s.user_id = '00000000-0000-4000-8000-0000000000a3')
    or exists (select 1 from public.user_settings s where s.user_id = '00000000-0000-4000-8000-0000000000a3')
    or exists (select 1 from public.slide_photos sp where sp.presentation_id = 'test-acd-t1') then
    raise exception 'FAIL: the deleted teacher''s rows are still there';
  end if;
  -- The editor's waiting work is gone; the approved receipt and "Reviewed by" stay, with no editor.
  if exists (select 1 from public.presentations p where p.id in ('test-acd-e1', 'test-acd-e2'))
    or exists (select 1 from public.presentation_reviews r where r.reviewer_id = '00000000-0000-4000-8000-0000000000a4')
    or not exists (
      select 1 from public.presentation_submissions s where s.copy_id is not null and s.submitter_id is null
    )
    or not exists (
      select 1 from public.presentation_reviewers r where r.presentation_id = 'test-acd-lesson' and r.reviewer_id is null
    ) then
    raise exception 'FAIL: the deleted editor''s rows aren''t as they should be';
  end if;
  -- The plain admin's QuizMatter presentation moved to the super admin; their shared photo stays.
  if not exists (
    select 1 from public.presentations p
    where p.id = 'test-acd-admin' and p.owner_id = '00000000-0000-4000-8000-0000000000a1'
  )
    or not exists (
      select 1 from public.shared_photos sp
      where sp.src = 'https://images.quizmatter.com/uploads/' || repeat('b', 64) || '.webp' and sp.uploaded_by is null
    ) then
    raise exception 'FAIL: the deleted admin''s QuizMatter work didn''t stay';
  end if;
  -- The lesson's like count went back down with the deleted like.
  if coalesce((select c.total from public.presentation_like_counts c where c.presentation_id = 'test-acd-lesson'), 0) <> 0 then
    raise exception 'FAIL: the deleted teacher''s like still counts';
  end if;
end $$;

rollback;
