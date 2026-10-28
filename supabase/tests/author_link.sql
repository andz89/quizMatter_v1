-- Author link: an editor's presentations and QuizMatter lessons keep their name as the Author, even after a rename
-- (supabase/migrations/20261216000000_author_link.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/author_link.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- e1 the editor ("Al Editor"), t1 a teacher, s1 the super admin, r1 another editor (the reviewer).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000b1', 'al-editor@example.com', '{"first_name": "Al", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000b2', 'al-teacher@example.com', '{"first_name": "Al", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000b3', 'al-super@example.com', '{"first_name": "Al", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000b4', 'al-reviewer@example.com', '{"first_name": "Al", "last_name": "Reviewer"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000b3', true);
insert into public.editors (user_id) values
  ('00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-4000-8000-0000000000b4');

-- Saves a presentation the way the app does (save_presentation), against its current save time, with this Author.
create function pg_temp.save(target text, new_author text)
returns bigint
language plpgsql
as $$
declare
  saved public.presentations;
begin
  select * into saved from public.presentations p where p.id = target;
  return public.save_presentation(
    presentation => jsonb_build_object(
      'id', target, 'title', 'Al ' || target, 'description', '', 'grades', '[]'::jsonb, 'subject', '', 'term', '',
      'week', '', 'day', '', 'curriculum', '', 'learningCompetency', '', 'author', new_author,
      'referenceLinks', '[]'::jsonb, 'tags', '[]'::jsonb, 'transition', 'slide', 'transitionSpeed', 3,
      'isPublished', coalesce(saved.is_published, false), 'fromAdmin', coalesce(saved.from_admin, false),
      'createdAt', 1790000000000,
      'slides', '[{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}]'::jsonb
    ),
    slide_ids => array['s1'],
    base_updated_at => floor(extract(epoch from saved.updated_at) * 1000)::bigint
  );
end;
$$;

-- Acts as this account, like a logged-in request.
create function pg_temp.act_as(account uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', account, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

-- ─── 1. The editor's own presentation: the editor is linked, whatever Author is sent ─────────────────────────
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b1');
select pg_temp.save('test-al-own', 'Someone else');

do $$
declare p public.presentations;
begin
  select * into p from public.presentations where id = 'test-al-own';
  if p.author_id is distinct from '00000000-0000-4000-8000-0000000000b1' or p.author is distinct from 'Al Editor' then
    raise exception 'FAIL: the editor''s own presentation isn''t linked to them: % / %', p.author_id, p.author;
  end if;
end $$;

-- ─── 2. A teacher's presentation: no link, the Author is what they typed ─────────────────────────────────────
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b2');
select pg_temp.save('test-al-t1', 'A book');

do $$
declare p public.presentations;
begin
  select * into p from public.presentations where id = 'test-al-t1';
  if p.author_id is not null or p.author is distinct from 'A book' then
    raise exception 'FAIL: a teacher''s presentation got a link or lost its Author: % / %', p.author_id, p.author;
  end if;
end $$;

-- ─── 3. A teacher can't link their presentation to an editor with a direct write ──────────────────────────────
insert into public.presentations (id, owner_id, title, author_id)
values ('test-al-t2', '00000000-0000-4000-8000-0000000000b2', 'Posing', '00000000-0000-4000-8000-0000000000b1');
update public.presentations set author_id = '00000000-0000-4000-8000-0000000000b1' where id = 'test-al-t1';

do $$
begin
  if exists (
    select 1 from public.presentations
    where id in ('test-al-t1', 'test-al-t2') and author_id is not null
  ) then
    raise exception 'FAIL: a teacher linked a presentation to an editor with a direct write';
  end if;
end $$;

-- ─── 4. The editor can't change the link or the Author with a direct write ────────────────────────────────────
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b1');
update public.presentations
set author_id = '00000000-0000-4000-8000-0000000000b2', author = 'X'
where id = 'test-al-own';

do $$
declare p public.presentations;
begin
  select * into p from public.presentations where id = 'test-al-own';
  if p.author_id is distinct from '00000000-0000-4000-8000-0000000000b1' or p.author is distinct from 'Al Editor' then
    raise exception 'FAIL: a direct write changed the link or the Author: % / %', p.author_id, p.author;
  end if;
end $$;

-- ─── 5. Approving the editor's submission: the QuizMatter lesson is linked to them ───────────────────────────
reset role;
insert into public.presentation_submissions (presentation_id, submitter_id, status, title)
values ('test-al-own', '00000000-0000-4000-8000-0000000000b1', 'submitted', 'Al test-al-own');
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b3');
select public.approve_submission(target_id => 'test-al-own');

-- Submission rows have no read rule (only the database's functions read them): keep the lesson's id here.
reset role;
create temp table lesson as
select copy_id as id from public.presentation_submissions where presentation_id = 'test-al-own';
grant select on lesson to authenticated;
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b3');

do $$
declare p public.presentations;
begin
  select * into p from public.presentations where id = (select id from lesson);
  if not p.from_admin or p.author_id is distinct from '00000000-0000-4000-8000-0000000000b1'
     or p.author is distinct from 'Al Editor' then
    raise exception 'FAIL: the approved lesson isn''t linked to its editor: % / %', p.author_id, p.author;
  end if;
end $$;

-- ─── 6. The admin can't retype the lesson's Author ────────────────────────────────────────────────────────────
select pg_temp.save((select id from lesson), 'Admin typed');

do $$
declare p public.presentations;
begin
  select * into p from public.presentations where id = (select id from lesson);
  if p.author_id is distinct from '00000000-0000-4000-8000-0000000000b1' or p.author is distinct from 'Al Editor' then
    raise exception 'FAIL: an admin''s save changed the lesson''s Author: % / %', p.author_id, p.author;
  end if;
end $$;

-- ─── 7. Another editor reviews the lesson, so it's locked ─────────────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b4');
select public.start_review(target_id => (select id from lesson));

reset role;
create temp table before_rename as
select id, updated_at from public.presentations where author_id = '00000000-0000-4000-8000-0000000000b1';
grant select on before_rename to authenticated;
-- The editor's presentation saves so far (click_rate has no read rule for them).
create temp table saves_before as
select coalesce(sum(r.clicks), 0) as clicks from public.click_rate r
where r.user_id = '00000000-0000-4000-8000-0000000000b1' and r.feature like 'presentation_save%';
set local role authenticated;

-- ─── 8. The editor changes their display name: both get it, their save times stay ─────────────────────────────
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b1');
-- A new request: nothing counted yet.
select set_config('quizmatter.write_counted', '', true);

do $$
begin
  if public.set_display_name(name => 'Al Renamed') ->> 'status' is distinct from 'saved' then
    raise exception 'FAIL: the rename wasn''t saved';
  end if;
  -- The save counter's flag is left as it was, so a later save in the same request still counts.
  if coalesce(current_setting('quizmatter.write_counted', true), '') <> '' then
    raise exception 'FAIL: the rename left the save counter''s flag set';
  end if;
end $$;

-- A rename is counted by the display_name limit only, never as a presentation save.
reset role;
do $$
begin
  if (select coalesce(sum(r.clicks), 0) from public.click_rate r
      where r.user_id = '00000000-0000-4000-8000-0000000000b1' and r.feature like 'presentation_save%')
     <> (select clicks from saves_before) then
    raise exception 'FAIL: the rename counted as a presentation save';
  end if;
end $$;
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b1');

do $$
begin
  if (select count(*) from before_rename) <> 2 then
    raise exception 'FAIL: setup: the editor should have 2 linked presentations';
  end if;
  if exists (
    select 1 from public.presentations p join before_rename b on b.id = p.id
    where p.author is distinct from 'Al Renamed' or p.updated_at <> b.updated_at
  ) then
    raise exception 'FAIL: the rename didn''t reach every linked presentation, or changed a save time';
  end if;
end $$;

-- ─── 9. The lock still refuses anyone else's change to the Author ─────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b3');

do $$
begin
  update public.presentations set author = 'Y'
  where id = (select id from lesson);
  raise exception 'FAIL: the review lock let a change to the Author through';
exception when sqlstate 'QMREV' then
  null;
end $$;

-- ─── 10. A tab opened before the rename saves the old Author: no conflict, the new name stays ─────────────────
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b1');
select pg_temp.save('test-al-own', 'Al Editor');

do $$
begin
  if (select author from public.presentations where id = 'test-al-own') is distinct from 'Al Renamed' then
    raise exception 'FAIL: an old tab''s save put the old name back';
  end if;
end $$;

-- ─── 11. The editor role is taken away: their own presentation unlinks on its next save, the lesson doesn't ───
reset role;
delete from public.editors where user_id = '00000000-0000-4000-8000-0000000000b1';
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000b1');
select pg_temp.save('test-al-own', 'Typed by me');

do $$
declare p public.presentations;
begin
  select * into p from public.presentations where id = 'test-al-own';
  if p.author_id is not null or p.author is distinct from 'Typed by me' then
    raise exception 'FAIL: a former editor''s presentation is still linked: % / %', p.author_id, p.author;
  end if;
  if (select author_id from public.presentations where id = (select id from lesson)) is distinct from '00000000-0000-4000-8000-0000000000b1' then
    raise exception 'FAIL: the lesson lost its link when the editor role was taken away';
  end if;
end $$;

rollback;
