-- Photo storage review fixes (supabase/migrations/20261231002700_photo_storage_fixes.sql; release's newest form,
-- with written_at, in 20261231002800_photo_storage_fixes_2.sql): saving a slide checks the
-- limit too, and reserve_photo_upload / release_photo_upload give a reservation back.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/photo_storage_fixes.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- t1 a teacher (50 MB), t2 another teacher, t3 an admin.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000006a1', 'psf-teacher@example.com', '{"first_name": "Psf", "last_name": "One"}'),
  ('00000000-0000-4000-8000-0000000006a2', 'psf-other@example.com', '{"first_name": "Psf", "last_name": "Two"}'),
  ('00000000-0000-4000-8000-0000000006a3', 'psf-admin@example.com', '{"first_name": "Psf", "last_name": "Admin"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000006a3');

create function pg_temp.f(x text) returns text language sql as $$
  select 'https://images.quizmatter.com/uploads/' || repeat(x, 64) || '.webp';
$$;
create function pg_temp.slide_with(src text) returns jsonb language sql as $$
  select jsonb_build_object('id', 's', 'type', 'blank', 'elements',
    jsonb_build_array(jsonb_build_object('id', 'e1', 'src', src)));
$$;
-- n uploads of 2 MB, uploaded just now (held for 10 minutes, so they count).
create function pg_temp.fill(target uuid, n int) returns void language sql as $$
  insert into public.photo_uploads (user_id, src, bytes)
  select target, 'https://images.quizmatter.com/uploads/' || md5(target::text || i) || md5(i::text) || '.webp', 2097152
  from generate_series(1, n) i;
$$;

-- t1: 25 × 2 MB held = 52428800, the whole 50 MB (with b below, a little over).
select pg_temp.fill('00000000-0000-4000-8000-0000000006a1', 25);
-- a: t1 uploaded it an hour ago and took it out of My photos: it counts for nothing now.
insert into public.photo_uploads (user_id, src, bytes, created_at)
values ('00000000-0000-4000-8000-0000000006a1', pg_temp.f('a'), 2097152, now() - interval '1 hour');
-- b: t1's, in their My photos (counts already).
insert into public.photo_uploads (user_id, src, bytes, created_at)
values ('00000000-0000-4000-8000-0000000006a1', pg_temp.f('b'), 1000, now() - interval '1 hour');
insert into public.photos (user_id, src, width, height)
values ('00000000-0000-4000-8000-0000000006a1', pg_temp.f('b'), 10, 10);
-- c: t2 uploaded it (t1 only copied it).
insert into public.photo_uploads (user_id, src, bytes, created_at)
values ('00000000-0000-4000-8000-0000000006a2', pg_temp.f('c'), 2097152, now() - interval '1 hour');

insert into public.presentations (id, owner_id, title)
values ('test-psf-p1', '00000000-0000-4000-8000-0000000006a1', 'Storage Quiz');
insert into public.slides (presentation_id, id, position, data)
values ('test-psf-p1', 's0', 0, '{"id": "s0", "type": "blank", "elements": []}'::jsonb);

-- ─── Saving a slide checks the limit ──────────────────────────────────────────────────────────────────────────
-- Full: putting a (which doesn't count now) back on a slide is refused, on insert and on update.
do $$
begin
  insert into public.slides (presentation_id, id, position, data)
  values ('test-psf-p1', 's1', 1, pg_temp.slide_with(pg_temp.f('a')));
  raise exception 'FAIL: a full teacher saved a new slide with an upload that didn''t count';
exception when sqlstate 'QMSTO' then
  if sqlerrm <> 'Your photo storage is full (50 MB).' then
    raise exception 'FAIL: the message was %', sqlerrm;
  end if;
end;
$$;
do $$
begin
  update public.slides set data = pg_temp.slide_with(pg_temp.f('a'))
  where presentation_id = 'test-psf-p1' and id = 's0';
  raise exception 'FAIL: a full teacher changed a slide to have an upload that didn''t count';
exception when sqlstate 'QMSTO' then
  null;
end;
$$;

-- Full, but a photo that already counts (b, in My photos) and a copied one (c, t2's upload) are fine.
insert into public.slides (presentation_id, id, position, data) values
  ('test-psf-p1', 's2', 2, pg_temp.slide_with(pg_temp.f('b'))),
  ('test-psf-p1', 's3', 3, pg_temp.slide_with(pg_temp.f('c')));
-- And a words-only change of a slide never checks.
update public.slides set data = data || '{"note": "x"}'::jsonb where presentation_id = 'test-psf-p1' and id = 's2';

-- With room (two held uploads gone: 23 × 2 MB + b = 48235496): a fits, is saved, and counts again.
delete from public.photo_uploads
where src in (select src from public.photo_uploads
              where user_id = '00000000-0000-4000-8000-0000000006a1' and bytes = 2097152 and src <> pg_temp.f('a')
              order by src limit 2);
insert into public.slides (presentation_id, id, position, data)
values ('test-psf-p1', 's1', 1, pg_temp.slide_with(pg_temp.f('a')));
do $$
begin
  if not public.photo_upload_counts('00000000-0000-4000-8000-0000000006a1', pg_temp.f('a')) then
    raise exception 'FAIL: a photo on a saved slide should count';
  end if;
  if public.photo_storage_used('00000000-0000-4000-8000-0000000006a1') <> 24 * 2097152 + 1000 then
    raise exception 'FAIL: expected 50332648 used, got %', public.photo_storage_used('00000000-0000-4000-8000-0000000006a1');
  end if;
end;
$$;

-- An admin has no limit: their own upload that doesn't count goes on a slide however full they are.
select pg_temp.fill('00000000-0000-4000-8000-0000000006a3', 30);
insert into public.photo_uploads (user_id, src, bytes, created_at)
values ('00000000-0000-4000-8000-0000000006a3', pg_temp.f('d'), 2097152, now() - interval '1 hour');
insert into public.presentations (id, owner_id, title, from_admin)
values ('test-psf-admin', '00000000-0000-4000-8000-0000000006a3', 'Admin Quiz', true);
insert into public.slides (presentation_id, id, position, data)
values ('test-psf-admin', 's1', 0, pg_temp.slide_with(pg_temp.f('d')));

-- ─── reserve_photo_upload answers `previous`; release_photo_upload gives it back ─────────────────────────────
-- t2: a new upload (e): previous is null; released = the row is gone.
do $$
declare
  answer jsonb;
begin
  answer := public.reserve_photo_upload('00000000-0000-4000-8000-0000000006a2', pg_temp.f('e'), 5000);
  if answer -> 'previous' <> 'null'::jsonb or answer ->> 'written_at' is null then
    raise exception 'FAIL: a new upload''s answer was %', answer;
  end if;
  perform public.release_photo_upload('00000000-0000-4000-8000-0000000006a2', pg_temp.f('e'), answer -> 'previous',
    (answer ->> 'written_at')::timestamptz);
  if exists (select 1 from public.photo_uploads where user_id = '00000000-0000-4000-8000-0000000006a2' and src = pg_temp.f('e')) then
    raise exception 'FAIL: a released new upload left its record';
  end if;
end;
$$;

-- t2 uploads c again: the old row (2 MB, an hour ago) is in previous; released = it's back as it was, so the
-- refused try holds no space.
do $$
declare
  answer jsonb;
  row_after public.photo_uploads;
begin
  answer := public.reserve_photo_upload('00000000-0000-4000-8000-0000000006a2', pg_temp.f('c'), 3000);
  if (answer -> 'previous' ->> 'bytes')::int <> 2097152 then
    raise exception 'FAIL: previous should hold the old size, got %', answer;
  end if;
  if not public.photo_upload_counts('00000000-0000-4000-8000-0000000006a2', pg_temp.f('c')) then
    raise exception 'FAIL: a reserved upload should count while it''s held';
  end if;
  perform public.release_photo_upload('00000000-0000-4000-8000-0000000006a2', pg_temp.f('c'), answer -> 'previous',
    (answer ->> 'written_at')::timestamptz);
  select * into row_after from public.photo_uploads where user_id = '00000000-0000-4000-8000-0000000006a2' and src = pg_temp.f('c');
  if row_after.bytes <> 2097152 or row_after.created_at > now() - interval '50 minutes' then
    raise exception 'FAIL: the released row wasn''t put back: % bytes, %', row_after.bytes, row_after.created_at;
  end if;
  if public.photo_storage_used('00000000-0000-4000-8000-0000000006a2') <> 0 then
    raise exception 'FAIL: a released re-upload still holds space';
  end if;
end;
$$;

-- ─── Teachers can't call the server's functions ──────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a2", "role": "authenticated"}', true);
do $$
begin
  perform public.release_photo_upload('00000000-0000-4000-8000-0000000006a1', pg_temp.f('a'), null, now());
  raise exception 'FAIL: a teacher called release_photo_upload';
exception when insufficient_privilege then
  null;
end;
$$;
do $$
begin
  perform public.photo_upload_counts('00000000-0000-4000-8000-0000000006a1', pg_temp.f('a'));
  raise exception 'FAIL: a teacher called photo_upload_counts';
exception when insufficient_privilege then
  null;
end;
$$;
reset role;

rollback;
