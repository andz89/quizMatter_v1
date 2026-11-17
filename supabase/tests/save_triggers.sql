-- The triggers that run on every save (save path review, round 2): the review lock on slides and details
-- (check_slide_review_lock, check_presentation_review_lock; 20261019000000_presentation_reviews.sql,
-- 20261216000000_author_link.sql), the submission lock, the publishing flag that lets publish_review through and
-- doesn't leak, a teacher can't fake a shared copy (check_shared_copy_change), and keep_copied_from.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/save_triggers.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher, another teacher, an editor, an admin; a lesson and two presentations ───
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', 'trg-teacher@example.com', '{"first_name": "Trg", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'trg-other@example.com', '{"first_name": "Trg", "last_name": "Other"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'trg-editor@example.com', '{"first_name": "Trg", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000c4', 'trg-admin@example.com', '{"first_name": "Trg", "last_name": "Admin"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000c4');
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000c3');

insert into public.presentations (id, owner_id, title, from_admin, is_published) values
  ('test-trg-lesson', '00000000-0000-4000-8000-0000000000c4', 'Lesson', true, true),
  ('test-trg-private', '00000000-0000-4000-8000-0000000000c2', 'Private', false, false),
  ('test-trg-editor', '00000000-0000-4000-8000-0000000000c3', 'Editor''s own', false, false);
insert into public.slides (presentation_id, id, position, data) values
  ('test-trg-lesson', 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "Lesson one"}'),
  ('test-trg-private', 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "Secret"}'),
  ('test-trg-editor', 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "Editor one"}');
select set_config('test.lesson_at',
  (select floor(extract(epoch from p.updated_at) * 1000)::bigint from public.presentations p where p.id = 'test-trg-lesson')::text, true);

-- A direct write to a slide or the details of a presentation; '' = it went through, else the error's code.
create function pg_temp.try(sql text)
returns text
language plpgsql
as $$
begin
  execute sql;
  return '';
exception when others then
  return sqlstate;
end;
$$;

-- ─── The editor starts a review: the lesson is locked ─────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c3', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.start_review(target_id => 'test-trg-lesson');

-- As the admin who owns the lesson: every change to its slides or details is refused, hiding isn't.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c4', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  got text;
  t record;
begin
  for t in
    select * from (values
      ('a slide update', $q$update public.slides set data = data || '{"question": "Changed"}' where presentation_id = 'test-trg-lesson' and id = 's1'$q$),
      ('a slide insert', $q$insert into public.slides (presentation_id, id, position, data) values ('test-trg-lesson', 's2', 1, '{"id": "s2", "type": "blank"}')$q$),
      ('a slide delete', $q$delete from public.slides where presentation_id = 'test-trg-lesson' and id = 's1'$q$),
      ('a title change', $q$update public.presentations set title = 'Changed' where id = 'test-trg-lesson'$q$),
      ('a delete', $q$delete from public.presentations where id = 'test-trg-lesson'$q$)
    ) as v(name, sql)
  loop
    got := pg_temp.try(t.sql);
    if got <> 'QMREV' then
      raise exception 'FAIL: % on a lesson under review wasn''t refused with QMREV (got "%")', t.name, got;
    end if;
  end loop;
end $$;

-- The owner's save_presentation is refused too, as one piece (the details change is what the lock sees first).
do $$
begin
  perform public.save_presentation(
    presentation => '{
      "id": "test-trg-lesson", "title": "Saved over", "description": "", "grades": [], "subject": "", "term": "",
      "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
      "transition": "slide", "transitionSpeed": 3, "isPublished": true, "fromAdmin": true, "createdAt": 1790000000000,
      "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "Saved over"}]
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => current_setting('test.lesson_at')::bigint
  );
  raise exception 'FAIL: the owner saved a lesson under review';
exception when sqlstate 'QMREV' then
  null;
end $$;

-- Hiding and showing get through the lock.
do $$
begin
  if pg_temp.try($q$update public.presentations set hidden_at = now() where id = 'test-trg-lesson'$q$) <> '' then
    raise exception 'FAIL: an admin couldn''t hide a lesson under review';
  end if;
  if pg_temp.try($q$update public.presentations set hidden_at = null where id = 'test-trg-lesson'$q$) <> '' then
    raise exception 'FAIL: an admin couldn''t show a lesson under review again';
  end if;
  if (select s.data ->> 'question' from public.slides s where s.presentation_id = 'test-trg-lesson' and s.id = 's1') <> 'Lesson one'
    or (select p.title from public.presentations p where p.id = 'test-trg-lesson') <> 'Lesson' then
    raise exception 'FAIL: a refused write still changed the lesson under review';
  end if;
end $$;

-- ─── The editor submits the review, and sends their own presentation to QuizMatter (locked too) ──────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c3', 'role', 'authenticated', 'aal', 'aal2')::text, true);

select public.submit_review(
  target_id => 'test-trg-lesson',
  review_draft => '{"id": "test-trg-lesson", "title": "Lesson, reviewed", "description": "", "subject": "", "curriculum": "",
    "learningCompetency": "", "slides": [{"id": "s1", "type": "blank", "elements": [], "question": "Lesson one, reviewed"}]}'::jsonb,
  reviewed_on => current_date,
  base_updated_at => null::bigint
);
select public.submit_presentation(target_id => 'test-trg-editor');

do $$
declare
  got text := pg_temp.try($q$update public.slides set data = data || '{"question": "Changed"}' where presentation_id = 'test-trg-editor' and id = 's1'$q$);
begin
  if got <> 'QMREV' then
    raise exception 'FAIL: an editor changed a slide of a presentation waiting for QuizMatter (got "%")', got;
  end if;
end $$;

-- ─── The admin publishes the review: its writes get through, and the flag that let them doesn't leak ──────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c4', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.publish_review(target_id => 'test-trg-lesson');

do $$
begin
  if (select s.data ->> 'question' from public.slides s where s.presentation_id = 'test-trg-lesson' and s.id = 's1') <> 'Lesson one, reviewed'
    or (select p.title from public.presentations p where p.id = 'test-trg-lesson') <> 'Lesson, reviewed' then
    raise exception 'FAIL: publishing the review didn''t write the draft into the lesson';
  end if;
  if coalesce(current_setting('quizmatter.publishing_review', true), '') <> '' then
    raise exception 'FAIL: publish_review left its flag on';
  end if;
  -- The round is published, so the lesson is open again.
  if pg_temp.try($q$update public.slides set data = data || '{"question": "After"}' where presentation_id = 'test-trg-lesson' and id = 's1'$q$) <> '' then
    raise exception 'FAIL: the lesson stayed locked after its review was published';
  end if;
end $$;

-- Still in the same transaction: the editor's submitted presentation is still locked.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c3', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  got text := pg_temp.try($q$update public.slides set data = data || '{"question": "Changed"}' where presentation_id = 'test-trg-editor' and id = 's1'$q$);
begin
  if got <> 'QMREV' then
    raise exception 'FAIL: after publish_review, the lock on another presentation was gone (got "%")', got;
  end if;
end $$;

-- ─── A teacher can't fake a shared copy (which would skip the 50-presentation limit and the create count) ───
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

insert into public.presentations (id, title) values ('test-trg-t', 'Mine');

do $$
declare
  got text;
begin
  got := pg_temp.try($q$insert into public.presentations (id, title, shared_from, shared_at) values ('test-trg-fake', 'Fake copy', 'test-trg-t', now())$q$);
  if got <> '42501' then
    raise exception 'FAIL: a teacher inserted a presentation marked as a shared copy (got "%")', got;
  end if;
  got := pg_temp.try($q$insert into public.presentations (id, title, shared_at) values ('test-trg-fake2', 'Fake copy', now())$q$);
  if got <> '42501' then
    raise exception 'FAIL: a teacher inserted a presentation with a shared_at (got "%")', got;
  end if;
  got := pg_temp.try($q$update public.presentations set shared_from = 'test-trg-lesson' where id = 'test-trg-t'$q$);
  if got <> '42501' then
    raise exception 'FAIL: a teacher turned their presentation into a shared copy (got "%")', got;
  end if;
end $$;

-- ─── copied_from: only a source the saver can read, never itself; and it's set once ───────────────────────
do $$
declare
  src record;
begin
  for src in
    select * from (values
      ('test-trg-copy-private', 'test-trg-private', null::text),  -- another teacher's private presentation
      ('test-trg-copy-self', 'test-trg-copy-self', null::text),   -- itself
      ('test-trg-copy-none', 'no-such-presentation', null::text), -- doesn't exist
      ('test-trg-copy-lesson', 'test-trg-lesson', 'test-trg-lesson') -- a published lesson: kept
    ) as v(id, copied_from, expected)
  loop
    perform public.save_presentation(
      presentation => jsonb_build_object(
        'id', src.id, 'title', 'Copy', 'description', '', 'grades', '[]'::jsonb, 'subject', '', 'term', '', 'week', '',
        'day', '', 'curriculum', '', 'learningCompetency', '', 'author', '', 'referenceLinks', '[]'::jsonb,
        'tags', '[]'::jsonb, 'transition', 'slide', 'transitionSpeed', 3, 'isPublished', false, 'fromAdmin', false,
        'createdAt', 1790000000000, 'copiedFrom', src.copied_from,
        'slides', '[{"id": "s1", "type": "blank", "elements": []}]'::jsonb
      ),
      slide_ids => array['s1'],
      base_updated_at => null::bigint
    );
    if (select p.copied_from from public.presentations p where p.id = src.id) is distinct from src.expected then
      raise exception 'FAIL: copied_from for % should be % (source %)', src.id, coalesce(src.expected, 'empty'), src.copied_from;
    end if;
  end loop;
end $$;

-- A later direct write can't set or change it.
update public.presentations set copied_from = 'test-trg-lesson' where id = 'test-trg-copy-private';
update public.presentations set copied_from = null where id = 'test-trg-copy-lesson';

do $$
begin
  if (select p.copied_from from public.presentations p where p.id = 'test-trg-copy-private') is not null
    or (select p.copied_from from public.presentations p where p.id = 'test-trg-copy-lesson') is distinct from 'test-trg-lesson' then
    raise exception 'FAIL: a direct write changed copied_from';
  end if;
end $$;

reset role;
rollback;
