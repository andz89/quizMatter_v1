-- Data version cap (supabase/migrations/20261210000000_data_version_cap.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/data_version_cap.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher, an editor, an admin and a shared QuizMatter lesson ──────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'cap-teacher@example.com', '{"first_name": "Cap", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'cap-editor@example.com', '{"first_name": "Cap", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000a3', 'cap-admin@example.com', '{"first_name": "Cap", "last_name": "Admin"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000a3');
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000a2');
insert into public.presentations (id, owner_id, title, from_admin, is_published)
values ('test-cap-lesson', '00000000-0000-4000-8000-0000000000a3', 'Cap lesson', true, true);

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- A save with a huge app_version is stored with the newest version the database knows (0).
select public.save_presentation(
  presentation => '{
    "id": "test-cap-a", "title": "Cap A", "description": "", "grades": [], "subject": "", "term": "", "week": "",
    "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
    "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false, "createdAt": 1790000000000,
    "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint,
  app_version => 2147483647
);

do $$
begin
  if (select p.data_version from public.presentations p where p.id = 'test-cap-a') is distinct from 0 then
    raise exception 'FAIL: save_presentation stored an app_version above current_data_version()';
  end if;
end $$;

-- Writing the column straight to the table can't raise it either.
update public.presentations set data_version = 99 where id = 'test-cap-a';

do $$
begin
  if (select p.data_version from public.presentations p where p.id = 'test-cap-a') is distinct from 0 then
    raise exception 'FAIL: a direct update raised data_version above current_data_version()';
  end if;
end $$;

-- ─── As the editor: a review draft ────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true);

select public.start_review(target_id => 'test-cap-lesson');
select public.save_review_draft(
  target_id => 'test-cap-lesson',
  review_draft => '{"id": "test-cap-lesson", "title": "Cap lesson", "slides": [{"id": "s1", "type": "blank"}]}'::jsonb,
  base_updated_at => null::bigint,
  app_version => 99
);

do $$
begin
  if (select r.draft_version from public.presentation_reviews r where r.presentation_id = 'test-cap-lesson')
    is distinct from 0 then
    raise exception 'FAIL: save_review_draft stored an app_version above current_data_version()';
  end if;
end $$;

-- ─── Copy refusal: a source saved by newer app code (set up as postgres, past the cap) ─────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
alter table public.presentations disable trigger cap_presentation_data_version;
update public.presentations set data_version = 1 where id = 'test-cap-a';
alter table public.presentations enable trigger cap_presentation_data_version;

do $$
begin
  if (select p.data_version from public.presentations p where p.id = 'test-cap-a') is distinct from 1 then
    raise exception 'FAIL: setup: the source''s data_version isn''t 1';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- An older app (0) making a copy of it is refused.
do $$
begin
  perform public.save_presentation(
    presentation => '{
      "id": "test-cap-copy", "title": "Cap copy", "description": "", "grades": [], "subject": "", "term": "",
      "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
      "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
      "createdAt": 1790000000000, "copiedFrom": "test-cap-a",
      "slides": [{"id": "s1", "type": "blank", "elements": []}]
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => null::bigint,
    app_version => 0
  );
  raise exception 'FAIL: a copy of a presentation saved by newer app code was saved by an older app';
exception when sqlstate 'QMOLD' then
  null;
end $$;

-- An app as new as the source copies it (stored at the cap, and copied_from kept).
select public.save_presentation(
  presentation => '{
    "id": "test-cap-copy", "title": "Cap copy", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
    "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
    "createdAt": 1790000000000, "copiedFrom": "test-cap-a",
    "slides": [{"id": "s1", "type": "blank", "elements": []}]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint,
  app_version => 1
);

do $$
begin
  if not exists (
    select 1 from public.presentations p
    where p.id = 'test-cap-copy' and p.data_version = 0 and p.copied_from = 'test-cap-a'
  ) then
    raise exception 'FAIL: an up-to-date copy wasn''t saved at the cap with its copied_from';
  end if;
end $$;

-- ─── Sharing carries the version to the shared copy ───────────────────────────────────────────────────────
-- The cap is off for this part (as postgres), so the copy can show the original's version (1, set above) instead of
-- the cap (0). The original has a title and a question, so it can be published.
reset role;
select set_config('request.jwt.claims', '', true);
alter table public.presentations disable trigger cap_presentation_data_version;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- Publish: a new shared copy (the insert branch).
select public.share_presentation(target_id => 'test-cap-a');

do $$
begin
  if (select p.data_version from public.presentations p where p.shared_from = 'test-cap-a') is distinct from 1 then
    raise exception 'FAIL: a new shared copy didn''t get its original''s data_version';
  end if;
end $$;

-- Update shared presentation: the copy is written again (the update branch).
reset role;
select set_config('request.jwt.claims', '', true);
update public.presentations set data_version = 2 where id = 'test-cap-a';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

select public.share_presentation(target_id => 'test-cap-a');

do $$
begin
  if (select p.data_version from public.presentations p where p.shared_from = 'test-cap-a') is distinct from 2 then
    raise exception 'FAIL: an updated shared copy didn''t get its original''s data_version';
  end if;
end $$;

reset role;
alter table public.presentations enable trigger cap_presentation_data_version;

rollback;
