-- Sharing fixes (supabase/migrations/20261231001500_sharing_fixes.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/sharing_fixes.sql
-- Passes when it ends without an error. Everything is rolled back.
-- 1. A teacher can't delete an original whose shared copy is hidden (QMHID); an admin can.
-- 2. "Update shared presentation" is refused while the copy is hidden.
-- 3. A copy of a copy of a hidden presentation can't be published (the whole copied_from chain is checked).
-- 4. A hidden slide and an empty text box don't count as content (QMPUB).
-- 5. share_presentation copies every column, except the ones listed below that differ on purpose.
-- 6. An admin can still hide and show a shared copy.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- f1 a teacher, f2 the super admin.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f1', 'shf-teacher@example.com', '{"first_name": "Shf", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'shf-admin@example.com', '{"first_name": "Shf", "last_name": "Admin"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000f2', true);

-- a: shared, then its copy is hidden. b: a copy of a, c: a copy of b (made before the hide, like "Make a copy").
-- cols: every detail filled, to check the copy gets them all. The last three are only checked for content.
insert into public.presentations (id, owner_id, title) values
  ('test-shf-a', '00000000-0000-4000-8000-0000000000f1', 'Hidden later');
insert into public.presentations (id, owner_id, title, copied_from) values
  ('test-shf-b', '00000000-0000-4000-8000-0000000000f1', 'Copy of a', 'test-shf-a');
insert into public.presentations (id, owner_id, title, copied_from) values
  ('test-shf-c', '00000000-0000-4000-8000-0000000000f1', 'Copy of b', 'test-shf-b');
insert into public.presentations (
  id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author,
  reference_links, tags, transition, transition_speed, data_version
) values (
  'test-shf-cols', '00000000-0000-4000-8000-0000000000f1', 'Every column', 'About it', '{"Grade 1"}', 'Math', 'Q1',
  'Week 2', 'Monday', 'MATATAG', 'Counts to 10', 'Shf Teacher', '{"https://example.com"}', '{"counting"}', 'fade', 5,
  public.current_data_version()
);
insert into public.presentations (id, owner_id, title, data_version) values
  ('test-shf-hidden-slide', '00000000-0000-4000-8000-0000000000f1', 'Only a hidden slide', public.current_data_version()),
  ('test-shf-empty-text', '00000000-0000-4000-8000-0000000000f1', 'Only an empty text box', public.current_data_version()),
  ('test-shf-text', '00000000-0000-4000-8000-0000000000f1', 'A text box with text', public.current_data_version());

insert into public.slides (presentation_id, id, position, data)
select p.id, 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}'::jsonb
from public.presentations p
where p.id in ('test-shf-a', 'test-shf-b', 'test-shf-c', 'test-shf-cols');
insert into public.slides (presentation_id, id, position, data) values
  ('test-shf-hidden-slide', 's1', 0,
    '{"id": "s1", "type": "blank", "hidden": true, "elements": [], "question": "What is 1 + 1?"}'),
  ('test-shf-empty-text', 's1', 0,
    '{"id": "s1", "type": "blank", "question": "", "elements": [{"id": "e1", "assetId": "text-box", "x": 0, "y": 0,
      "width": 100, "height": 40, "color": "#000000", "containerId": null, "text": {"html": "<p> &nbsp;</p><p></p>"}}]}'),
  ('test-shf-text', 's1', 0,
    '{"id": "s1", "type": "blank", "question": "", "elements": [{"id": "e1", "assetId": "text-box", "x": 0, "y": 0,
      "width": 100, "height": 40, "color": "#000000", "containerId": null, "text": {"html": "<p>Hi</p>"}}]}');

-- ─── As the teacher: publish a and cols ───────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.share_presentation(target_id => 'test-shf-a');
select public.share_presentation(target_id => 'test-shf-cols');

-- 5. Every column of the original is on its copy, except these, which differ on purpose: the copy's own id and
-- times, its link to the original, published, the admin's hide, copied_from (only set by "Make a copy") and
-- author_id (only an editor's, and editors don't publish). A new column must be copied by share_presentation (in
-- both its insert and its update) or added here with its reason.
do $$
declare
  original jsonb;
  copy jsonb;
  missing text;
begin
  select to_jsonb(p) into original from public.presentations p where p.id = 'test-shf-cols';
  select to_jsonb(p) into copy from public.presentations p where p.shared_from = 'test-shf-cols';
  select string_agg(k, ', ') into missing
  from jsonb_object_keys(original) k
  where k not in ('id', 'created_at', 'updated_at', 'shared_from', 'shared_at', 'is_published', 'hidden_at',
      'copied_from', 'author_id')
    and original -> k is distinct from copy -> k;
  if missing is not null then
    raise exception 'FAIL: the shared copy doesn''t match its original in: %', missing;
  end if;
end $$;

-- ─── As the admin: hide a's copy, show it, and hide it again ──────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- 6. Hide and show work on a shared copy.
do $$
declare n int;
begin
  update public.presentations set hidden_at = now() where shared_from = 'test-shf-a';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the admin couldn''t hide the shared copy';
  end if;
  update public.presentations set hidden_at = null where shared_from = 'test-shf-a';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the admin couldn''t show the shared copy again';
  end if;
  update public.presentations set hidden_at = now() where shared_from = 'test-shf-a';
end $$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- 2. "Update shared presentation" on the hidden copy is refused, and the copy keeps its content.
do $$
begin
  update public.slides set data = jsonb_set(data, '{question}', '"Changed"') where presentation_id = 'test-shf-a';
  perform public.share_presentation(target_id => 'test-shf-a');
  raise exception 'FAIL: a hidden shared copy was updated';
exception when insufficient_privilege then
  null;
end $$;

-- 3. A copy (b) and a copy of a copy (c) can't be published.
do $$
begin
  perform public.share_presentation(target_id => 'test-shf-b');
  raise exception 'FAIL: a copy of a presentation with a hidden copy was published';
exception when insufficient_privilege then
  null;
end $$;

do $$
begin
  perform public.share_presentation(target_id => 'test-shf-c');
  raise exception 'FAIL: a copy of a copy of a presentation with a hidden copy was published';
exception when insufficient_privilege then
  null;
end $$;

-- 1. Deleting the original (which would take the hidden copy with it) is refused.
do $$
begin
  delete from public.presentations where id = 'test-shf-a';
  raise exception 'FAIL: the teacher deleted an original whose shared copy is hidden';
exception when sqlstate 'QMHID' then
  null;
end $$;

-- Deleting a copy of it is still fine (b has no shared copy). c's chain now stops at b.
delete from public.presentations where id = 'test-shf-b';

-- 4. A hidden slide doesn't count as content.
do $$
begin
  perform public.share_presentation(target_id => 'test-shf-hidden-slide');
  raise exception 'FAIL: a presentation with only a hidden slide was published';
exception when sqlstate 'QMPUB' then
  null;
end $$;

-- 4. An empty text box doesn't count as content.
do $$
begin
  perform public.share_presentation(target_id => 'test-shf-empty-text');
  raise exception 'FAIL: a presentation with only an empty text box was published';
exception when sqlstate 'QMPUB' then
  null;
end $$;

-- 4. A text box with text does.
select public.share_presentation(target_id => 'test-shf-text');

-- ─── As the admin: deleting the original still works (Admin → Reports → Delete) ───────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare n int;
begin
  delete from public.presentations where id = 'test-shf-a';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the admin couldn''t delete the original of a hidden shared copy';
  end if;
end $$;

reset role;
do $$
begin
  if exists (select 1 from public.presentations where shared_from = 'test-shf-a') then
    raise exception 'FAIL: the hidden shared copy stayed after its original was deleted';
  end if;
end $$;

rollback;
