-- Each tag, reference and grade has a length limit (supabase/migrations/20261231001800_detail_item_lengths.sql).
-- zod (src/lib/schema.ts) refuses a tag over 30 characters, a reference over 500 and a grade over 40, but the
-- database only counted them, so a save sent straight to the API could keep a huge one (it then also broke the
-- presentation's opening). Now the presentations table refuses them (23514), and so does a review draft (22023),
-- which publish_review would write there.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/detail_item_lengths.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher, an editor, an admin and a shared QuizMatter lesson ────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'dil-teacher@example.com', '{"first_name": "Dil", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'dil-editor@example.com', '{"first_name": "Dil", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'dil-admin@example.com', '{"first_name": "Dil", "last_name": "Admin"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000e3');
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000e2');
insert into public.presentations (id, owner_id, title, from_admin, is_published)
values ('test-dil-lesson', '00000000-0000-4000-8000-0000000000e3', 'Dil lesson', true, true);
insert into public.slides (presentation_id, id, position, data)
values ('test-dil-lesson', 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "One"}');

-- What the app sends with every save (presentationSchema), with the given details changed.
create function pg_temp.pres(extra jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', 'test-dil-a', 'title', 'Dil A', 'description', '', 'grades', '[]'::jsonb, 'subject', '', 'term', '',
    'week', '', 'day', '', 'curriculum', '', 'learningCompetency', '', 'author', '', 'referenceLinks', '[]'::jsonb,
    'tags', '[]'::jsonb, 'transition', 'slide', 'transitionSpeed', 3, 'isPublished', false, 'fromAdmin', false,
    'createdAt', 1790000000000, 'slides', '[{"id": "s1", "type": "blank", "elements": [], "question": "One"}]'::jsonb
  ) || extra;
$$;

-- The details that are one character too long, and the same at the limit.
create function pg_temp.too_long()
returns setof jsonb
language sql
as $$
  values
    (jsonb_build_object('tags', jsonb_build_array(repeat('t', 31)))),
    (jsonb_build_object('referenceLinks', jsonb_build_array('Book', repeat('r', 501)))),
    (jsonb_build_object('grades', jsonb_build_array('Grade 1', repeat('g', 41))));
$$;
create function pg_temp.at_limit()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'tags', jsonb_build_array(repeat('t', 30)),
    'referenceLinks', jsonb_build_array(repeat('r', 500)),
    'grades', jsonb_build_array(repeat('g', 40))
  );
$$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- A new presentation with a detail too long is refused.
do $$
declare
  extra jsonb;
begin
  for extra in select pg_temp.too_long() loop
    begin
      perform public.save_presentation(
        presentation => pg_temp.pres(extra), slide_ids => array['s1'], base_updated_at => null::bigint, app_version => 3
      );
      raise exception 'FAIL: a new presentation was saved with %', extra;
    exception when sqlstate '23514' then
      null;
    end;
  end loop;
end $$;

-- At the limit it saves.
select set_config('test.saved_at', public.save_presentation(
  presentation => pg_temp.pres(pg_temp.at_limit()), slide_ids => array['s1'], base_updated_at => null::bigint, app_version => 3
)::text, true);

-- A later save, or a write straight to the table, with a detail too long is refused too.
do $$
declare
  extra jsonb;
begin
  for extra in select pg_temp.too_long() loop
    begin
      perform public.save_presentation(
        presentation => pg_temp.pres(extra), slide_ids => array['s1'],
        base_updated_at => current_setting('test.saved_at')::bigint, app_version => 3
      );
      raise exception 'FAIL: a later save went through with %', extra;
    exception when sqlstate '23514' then
      null;
    end;
  end loop;
  begin
    update public.presentations set tags = array[repeat('t', 31)] where id = 'test-dil-a';
    raise exception 'FAIL: a tag too long was written straight to the table';
  exception when sqlstate '23514' then
    null;
  end;
end $$;

do $$
begin
  if (select p.tags from public.presentations p where p.id = 'test-dil-a') <> array[repeat('t', 30)] then
    raise exception 'FAIL: the presentation at the limit wasn''t kept as it was';
  end if;
end $$;

-- ─── As the editor: a review draft with a detail too long is refused at save and at submit ──────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.start_review(target_id => 'test-dil-lesson');

do $$
declare
  draft jsonb := '{"id": "test-dil-lesson", "title": "Dil lesson", "description": "", "subject": "", "curriculum": "",
    "learningCompetency": "", "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "One"}]}';
  extra jsonb;
begin
  for extra in select pg_temp.too_long() loop
    begin
      perform public.save_review_draft(target_id => 'test-dil-lesson', review_draft => draft || extra, base_updated_at => null::bigint);
      raise exception 'FAIL: a review draft was saved with %', extra;
    exception when sqlstate '22023' then
      null;
    end;
    begin
      perform public.submit_review(
        target_id => 'test-dil-lesson', review_draft => draft || extra, reviewed_on => current_date, base_updated_at => null::bigint
      );
      raise exception 'FAIL: a review draft was submitted with %', extra;
    exception when sqlstate '22023' then
      null;
    end;
  end loop;

  -- At the limit it saves.
  perform public.save_review_draft(
    target_id => 'test-dil-lesson', review_draft => draft || pg_temp.at_limit(), base_updated_at => null::bigint
  );
end $$;

do $$
begin
  if (select r.draft_updated_at from public.presentation_reviews r where r.presentation_id = 'test-dil-lesson') is null then
    raise exception 'FAIL: the review draft at the limit wasn''t saved';
  end if;
end $$;

reset role;
rollback;
