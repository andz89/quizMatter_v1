-- Photo storage review fixes, round 4 (supabase/migrations/20261231002800_photo_storage_fixes_2.sql): a release
-- only changes the row its own reservation wrote, and moving one of your photos between slides in one save is never
-- new storage.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/photo_storage_fixes_2.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000007a1', 'psf2-teacher@example.com', '{"first_name": "Psf", "last_name": "One"}'),
  ('00000000-0000-4000-8000-0000000007a2', 'psf2-other@example.com', '{"first_name": "Psf", "last_name": "Two"}');

create function pg_temp.f(x text) returns text language sql as $$
  select 'https://images.quizmatter.com/uploads/' || repeat(x, 64) || '.webp';
$$;
create function pg_temp.slide_with(id text, src text) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'type', 'blank', 'elements',
    case when src is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id', 'e1', 'src', src)) end);
$$;

-- ─── A release leaves a later reservation of the same file alone ─────────────────────────────────────────────
-- t2 uploads e twice at once: A reserves (new), then B (replacing A's row). A is refused and releases: B's row stays.
do $$
declare
  a jsonb;
  b jsonb;
  row_after public.photo_uploads;
begin
  a := public.reserve_photo_upload('00000000-0000-4000-8000-0000000007a2', pg_temp.f('e'), 5000);
  b := public.reserve_photo_upload('00000000-0000-4000-8000-0000000007a2', pg_temp.f('e'), 6000);
  if a ->> 'written_at' = b ->> 'written_at' then
    raise exception 'FAIL: two reservations got the same time';
  end if;
  perform public.release_photo_upload('00000000-0000-4000-8000-0000000007a2', pg_temp.f('e'), a -> 'previous',
    (a ->> 'written_at')::timestamptz);
  select * into row_after from public.photo_uploads
  where user_id = '00000000-0000-4000-8000-0000000007a2' and src = pg_temp.f('e');
  if row_after is null then
    raise exception 'FAIL: an older release deleted the row a later upload was using';
  end if;
  if row_after.bytes <> 6000 or row_after.created_at <> (b ->> 'written_at')::timestamptz then
    raise exception 'FAIL: an older release changed the later upload''s row: % bytes, %', row_after.bytes, row_after.created_at;
  end if;
  -- B's own release still works (it gets A's row back, which B replaced).
  perform public.release_photo_upload('00000000-0000-4000-8000-0000000007a2', pg_temp.f('e'), b -> 'previous',
    (b ->> 'written_at')::timestamptz);
  select * into row_after from public.photo_uploads
  where user_id = '00000000-0000-4000-8000-0000000007a2' and src = pg_temp.f('e');
  if row_after.bytes <> 5000 then
    raise exception 'FAIL: B''s release didn''t put A''s row back (% bytes)', row_after.bytes;
  end if;
end;
$$;

-- ─── Moving a photo between slides in one save ───────────────────────────────────────────────────────────────
-- t1: a (uploaded an hour ago, not in My photos) on s2, c on s3; b (uploaded an hour ago) nowhere.
insert into public.photo_uploads (user_id, src, bytes, created_at) values
  ('00000000-0000-4000-8000-0000000007a1', pg_temp.f('a'), 1000, now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000007a1', pg_temp.f('b'), 1000, now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000007a1', pg_temp.f('c'), 1000, now() - interval '1 hour');
insert into public.presentations (id, owner_id, title)
values ('test-psf2-p1', '00000000-0000-4000-8000-0000000007a1', 'Move Quiz');
insert into public.slides (presentation_id, id, position, data) values
  ('test-psf2-p1', 's2', 0, pg_temp.slide_with('s2', pg_temp.f('a'))),
  ('test-psf2-p1', 's3', 1, pg_temp.slide_with('s3', pg_temp.f('c'))),
  ('test-psf2-p1', 's4', 2, pg_temp.slide_with('s4', null));
-- Then over the limit: 25 × 2 MB held (the whole 50 MB) plus a and c on slides.
insert into public.photo_uploads (user_id, src, bytes)
select '00000000-0000-4000-8000-0000000007a1',
  'https://images.quizmatter.com/uploads/' || md5('psf2' || i) || md5(i::text) || '.webp', 2097152
from generate_series(1, 25) i;

-- Cut a from s2 to s4 (s2 saved first, so a is on no slide when s4 is checked): allowed.
update public.slides set data = pg_temp.slide_with('s2', null) where presentation_id = 'test-psf2-p1' and id = 's2';
update public.slides set data = pg_temp.slide_with('s4', pg_temp.f('a')) where presentation_id = 'test-psf2-p1' and id = 's4';

-- Delete s3 (c goes with it) and paste c on a new slide s5: allowed.
delete from public.slides where presentation_id = 'test-psf2-p1' and id = 's3';
insert into public.slides (presentation_id, id, position, data)
values ('test-psf2-p1', 's5', 3, pg_temp.slide_with('s5', pg_temp.f('c')));

do $$
begin
  if not exists (select 1 from public.slide_photos where presentation_id = 'test-psf2-p1' and slide_id = 's4' and src = pg_temp.f('a'))
    or not exists (select 1 from public.slide_photos where presentation_id = 'test-psf2-p1' and slide_id = 's5' and src = pg_temp.f('c'))
  then
    raise exception 'FAIL: the moved photos weren''t saved on their new slides';
  end if;
end;
$$;

-- But b, which counted for nothing, is still refused, even in the same request as a move.
do $$
begin
  insert into public.slides (presentation_id, id, position, data)
  values ('test-psf2-p1', 's6', 4, pg_temp.slide_with('s6', pg_temp.f('b')));
  raise exception 'FAIL: a full teacher saved a photo that counted for nothing';
exception when sqlstate 'QMSTO' then
  null;
end;
$$;

-- Another teacher's request (another account) can't use what t1 freed: the list names the owner.
do $$
begin
  if public.slide_photo_freed('00000000-0000-4000-8000-0000000007a2', pg_temp.f('c')) then
    raise exception 'FAIL: a freed photo counted for another account';
  end if;
  if not public.slide_photo_freed('00000000-0000-4000-8000-0000000007a1', pg_temp.f('c')) then
    raise exception 'FAIL: c should be remembered as freed';
  end if;
end;
$$;

-- ─── Teachers can't call the new functions ───────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000007a2", "role": "authenticated"}', true);
do $$
begin
  perform public.release_photo_upload('00000000-0000-4000-8000-0000000007a1', pg_temp.f('a'), null, now());
  raise exception 'FAIL: a teacher called release_photo_upload';
exception when insufficient_privilege then
  null;
end;
$$;
do $$
begin
  perform public.slide_photo_freed('00000000-0000-4000-8000-0000000007a1', pg_temp.f('a'));
  raise exception 'FAIL: a teacher called slide_photo_freed';
exception when insufficient_privilege then
  null;
end;
$$;
reset role;

rollback;
