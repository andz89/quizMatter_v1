-- Database fixes (supabase/migrations/20261210000200_database_fixes.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/database_fixes.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- d1 super admin, d2 plain admin, d3 teacher whose account gets deleted, d4 editor, d5 teacher.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d1', 'dbf-super@example.com', '{"first_name": "Dbf", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000d2', 'dbf-admin@example.com', '{"first_name": "Dbf", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000d3', 'dbf-teacher@example.com', '{"first_name": "Dbf", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000d4', 'dbf-editor@example.com', '{"first_name": "Dbf", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000d5', 'dbf-other@example.com', '{"first_name": "Dbf", "last_name": "Other"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000000d1', true),
  ('00000000-0000-4000-8000-0000000000d2', false);
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000d4');

-- d3's presentation (shared below), d5's three (hidden and deleted below), the super admin's shared QuizMatter lesson.
insert into public.presentations (id, owner_id, title) values
  ('test-dbf-orig', '00000000-0000-4000-8000-0000000000d3', 'Original'),
  ('test-dbf-h1', '00000000-0000-4000-8000-0000000000d5', 'Hide one'),
  ('test-dbf-h2', '00000000-0000-4000-8000-0000000000d5', 'Hide two'),
  ('test-dbf-h3', '00000000-0000-4000-8000-0000000000d5', 'Hide three');
insert into public.presentations (id, owner_id, title, from_admin, is_published) values
  ('test-dbf-lesson', '00000000-0000-4000-8000-0000000000d1', 'Live lesson', true, true);
insert into public.slides (presentation_id, id, position, data)
select p.id, 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}'::jsonb
from public.presentations p
where p.id in ('test-dbf-orig', 'test-dbf-lesson');

-- Three shared photos the plain admin uploaded, in a category of their own.
insert into public.photo_categories (name) values ('Test dbf photos');
insert into public.shared_photos (src, width, height, category_id, uploaded_by)
select 'https://images.quizmatter.com/uploads/test-dbf-' || n || '.webp', 10, 10, c.id,
  '00000000-0000-4000-8000-0000000000d2'
from generate_series(1, 3) as n
cross join public.photo_categories c
where c.name = 'Test dbf photos';

-- ─── 1. Deleting an account with a hidden shared copy (D5) ────────────────────────────────────────────────────
-- As the teacher: publish the original (its shared copy is made after it).
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d3', 'role', 'authenticated')::text, true);

select public.share_presentation(target_id => 'test-dbf-orig');

-- As the plain admin: hide the shared copy.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d2', 'role', 'authenticated')::text, true);

update public.presentations set hidden_at = now() where shared_from = 'test-dbf-orig';

-- As the teacher: the hidden copy still can't be deleted by them.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d3', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  delete from public.presentations where shared_from = 'test-dbf-orig';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'FAIL: setup: the teacher can''t see their hidden shared copy';
  end if;
  raise exception 'FAIL: a teacher deleted their hidden shared copy';
exception when insufficient_privilege then
  if sqlerrm not like 'QuizMatter hid the shared copy%' then
    raise exception 'FAIL: deleting the hidden copy was refused for another reason: %', sqlerrm;
  end if;
end $$;

-- Then the teacher edits the original: its row is now newer than the copy's, so deleting the account reaches the
-- copy first, while the original is still there.
update public.presentations set title = 'Original, edited' where id = 'test-dbf-orig';

-- As postgres (no logged-in user, like the Supabase dashboard): delete the account.
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (select p.ctid from public.presentations p where p.shared_from = 'test-dbf-orig')
    > (select p.ctid from public.presentations p where p.id = 'test-dbf-orig') then
    raise exception 'FAIL: setup: the shared copy''s row isn''t older than the original''s';
  end if;
end $$;

do $$
begin
  delete from auth.users where id = '00000000-0000-4000-8000-0000000000d3';
exception when others then
  raise exception 'FAIL: deleting an account with a hidden shared copy was refused: %', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from public.presentations p where p.owner_id = '00000000-0000-4000-8000-0000000000d3') then
    raise exception 'FAIL: the deleted account''s presentations are still there';
  end if;
end $$;

-- ─── 2. The Admin log has a row for every row of a multi-row change (D6) ──────────────────────────────────────
-- Each app request is its own transaction, so its "already logged" flag starts empty. This test is one
-- transaction: before each step, the flag is cleared the way a new request would start.

-- As the plain admin: hide three presentations in one update.
select set_config('quizmatter.admin_logged', '', true);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d2', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  update public.presentations set hidden_at = now() where id in ('test-dbf-h1', 'test-dbf-h2', 'test-dbf-h3');
  get diagnostics n = row_count;
  if n <> 3 then
    raise exception 'FAIL: setup: the plain admin hid % presentations, not 3', n;
  end if;
end $$;

-- The same three, deleted in one delete (they're hidden, so a plain admin may).
select set_config('quizmatter.admin_logged', '', true);

do $$
declare n int;
begin
  delete from public.presentations where id in ('test-dbf-h1', 'test-dbf-h2', 'test-dbf-h3');
  get diagnostics n = row_count;
  if n <> 3 then
    raise exception 'FAIL: setup: the plain admin deleted % presentations, not 3', n;
  end if;
end $$;

-- Their three shared photos, deleted in one delete.
select set_config('quizmatter.admin_logged', '', true);

do $$
declare n int;
begin
  delete from public.shared_photos where src like 'https://images.quizmatter.com/uploads/test-dbf-%';
  get diagnostics n = row_count;
  if n <> 3 then
    raise exception 'FAIL: setup: the plain admin deleted % shared photos, not 3', n;
  end if;
end $$;

-- The log (only the super admin reads it: checked as postgres).
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare n int;
begin
  select count(*) into n from public.admin_actions a
  where a.action = 'presentation_hidden' and a.target_id in ('test-dbf-h1', 'test-dbf-h2', 'test-dbf-h3')
    and a.admin_id = '00000000-0000-4000-8000-0000000000d2';
  if n <> 3 then
    raise exception 'FAIL: hiding 3 presentations in one update logged % rows, not 3', n;
  end if;
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.admin_actions a
  where a.action = 'presentation_deleted' and a.target_id in ('test-dbf-h1', 'test-dbf-h2', 'test-dbf-h3')
    and a.admin_id = '00000000-0000-4000-8000-0000000000d2';
  if n <> 3 then
    raise exception 'FAIL: deleting 3 presentations in one delete logged % rows, not 3', n;
  end if;
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.admin_actions a
  where a.action = 'photo_deleted' and a.target_id like 'https://images.quizmatter.com/uploads/test-dbf-%'
    and a.admin_id = '00000000-0000-4000-8000-0000000000d2';
  if n <> 3 then
    raise exception 'FAIL: deleting 3 shared photos in one delete logged % rows, not 3', n;
  end if;
end $$;

-- ─── 3. A review draft is checked like the presentations table (D8) ───────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d4', 'role', 'authenticated')::text, true);

select public.start_review(target_id => 'test-dbf-lesson');

-- 11 tags, 15 grades, an unknown slide effect, speeds outside 1–5: each refused when saved.
do $$
declare
  base jsonb := '{"id": "test-dbf-lesson", "title": "Live lesson", "slides": [{"id": "s1", "type": "blank"}]}';
  bad jsonb;
begin
  foreach bad in array array[
    base || jsonb_build_object('tags', (select jsonb_agg('tag' || n) from generate_series(1, 11) as n)),
    base || jsonb_build_object('grades', (select jsonb_agg('Grade ' || n) from generate_series(1, 15) as n)),
    base || '{"transition": "spin"}',
    base || '{"transitionSpeed": 6}',
    base || '{"transitionSpeed": 0}',
    base || '{"transitionSpeed": 2.5}'
  ] loop
    begin
      perform public.save_review_draft(target_id => 'test-dbf-lesson', review_draft => bad, base_updated_at => null::bigint);
      raise exception 'FAIL: a bad review draft was saved: %', bad - 'slides';
    exception when invalid_parameter_value then
      if sqlerrm not like 'The draft has too many tags or grades%' then
        raise exception 'FAIL: a bad review draft was refused for another reason: %', sqlerrm;
      end if;
    end;
  end loop;
end $$;

-- At the limits it saves: 10 tags, 14 grades, a known effect, speed 5.
select public.save_review_draft(
  target_id => 'test-dbf-lesson',
  review_draft => jsonb_build_object(
    'id', 'test-dbf-lesson', 'title', 'Live lesson', 'transition', 'fade', 'transitionSpeed', 5,
    'tags', (select jsonb_agg('tag' || n) from generate_series(1, 10) as n),
    'grades', (select jsonb_agg('Grade ' || n) from generate_series(1, 14) as n),
    'slides', '[{"id": "s1", "type": "blank"}]'::jsonb
  ),
  base_updated_at => null::bigint
);

do $$
begin
  if (select r.draft ->> 'transition' from public.presentation_reviews r where r.presentation_id = 'test-dbf-lesson')
    is distinct from 'fade' then
    raise exception 'FAIL: a review draft at the limits wasn''t saved';
  end if;
end $$;

-- ─── 4. The "From editors" category can't be renamed or deleted (D10) ─────────────────────────────────────────
-- As the super admin (the only one the table's rules let rename or delete a category).
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  update public.photo_categories set name = 'Editor uploads' where lower(name) = 'from editors';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'FAIL: setup: there is no "From editors" category';
  end if;
  raise exception 'FAIL: the "From editors" category was renamed';
exception when insufficient_privilege then
  if sqlerrm not like 'This category holds editors'' photos%' then
    raise exception 'FAIL: renaming "From editors" was refused for another reason: %', sqlerrm;
  end if;
end $$;

do $$
declare n int;
begin
  delete from public.photo_categories where lower(name) = 'from editors';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'FAIL: setup: there is no "From editors" category';
  end if;
  raise exception 'FAIL: the "From editors" category was deleted';
exception when insufficient_privilege then
  if sqlerrm not like 'This category holds editors'' photos%' then
    raise exception 'FAIL: deleting "From editors" was refused for another reason: %', sqlerrm;
  end if;
end $$;

-- Other categories still rename and delete (the test one is empty now).
do $$
declare n int;
begin
  update public.photo_categories set name = 'Test dbf renamed' where name = 'Test dbf photos';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the super admin couldn''t rename another category';
  end if;
  delete from public.photo_categories where name = 'Test dbf renamed';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the super admin couldn''t delete another category';
  end if;
end $$;

rollback;
