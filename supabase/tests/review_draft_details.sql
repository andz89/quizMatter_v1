-- A review draft without its text details (supabase/migrations/20261231001700_review_draft_details.sql).
-- A draft sent straight to the API without a title, description, subject, curriculum or learning competency used
-- to save and submit fine, and then the admin's Publish failed with a raw not-null error (publish_review writes
-- them into the presentation). Now check_review_draft refuses it at save (22023), like the other checks.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/review_draft_details.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): an editor, an admin and a shared QuizMatter lesson ───────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d1', 'rdd-editor@example.com', '{"first_name": "Rdd", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000d2', 'rdd-admin@example.com', '{"first_name": "Rdd", "last_name": "Admin"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000d2');
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000d1');
insert into public.presentations (id, owner_id, title, from_admin, is_published)
values ('test-rdd-lesson', '00000000-0000-4000-8000-0000000000d2', 'Rdd lesson', true, true);
insert into public.slides (presentation_id, id, position, data)
values ('test-rdd-lesson', 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "One"}');

-- ─── As the editor ────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.start_review(target_id => 'test-rdd-lesson');

-- A draft missing any one of the text details is refused at save and at submit.
do $$
declare
  full_draft jsonb := '{"id": "test-rdd-lesson", "title": "Rdd lesson", "description": "", "subject": "", "curriculum": "",
    "learningCompetency": "", "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "One"}]}';
  missing text;
begin
  foreach missing in array array['title', 'description', 'subject', 'curriculum', 'learningCompetency'] loop
    begin
      perform public.save_review_draft(
        target_id => 'test-rdd-lesson',
        review_draft => full_draft - missing,
        base_updated_at => null::bigint
      );
      raise exception 'FAIL: a draft without % was saved', missing;
    exception when sqlstate '22023' then
      null;
    end;
    begin
      perform public.submit_review(
        target_id => 'test-rdd-lesson',
        review_draft => full_draft - missing,
        reviewed_on => current_date,
        base_updated_at => null::bigint
      );
      raise exception 'FAIL: a draft without % was submitted', missing;
    exception when sqlstate '22023' then
      null;
    end;
  end loop;

  -- The full draft still saves, submits and publishes.
  perform public.save_review_draft(target_id => 'test-rdd-lesson', review_draft => full_draft, base_updated_at => null::bigint);
end $$;

do $$
begin
  if (select r.draft_updated_at from public.presentation_reviews r where r.presentation_id = 'test-rdd-lesson') is null then
    raise exception 'FAIL: the full draft wasn''t saved';
  end if;
end $$;

select public.submit_review(
  target_id => 'test-rdd-lesson',
  review_draft => '{"id": "test-rdd-lesson", "title": "Rdd lesson, reviewed", "description": "", "subject": "", "curriculum": "",
    "learningCompetency": "", "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "One"}]}'::jsonb,
  reviewed_on => current_date,
  base_updated_at => (select floor(extract(epoch from r.draft_updated_at) * 1000)::bigint
    from public.presentation_reviews r where r.presentation_id = 'test-rdd-lesson')
);

-- ─── As the admin: Publish works ──────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d2', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.publish_review(target_id => 'test-rdd-lesson');

do $$
begin
  if (select p.title from public.presentations p where p.id = 'test-rdd-lesson') <> 'Rdd lesson, reviewed' then
    raise exception 'FAIL: the full draft wasn''t published';
  end if;
end $$;

reset role;
rollback;
