-- Photo storage limit, 50 MB per teacher (supabase/migrations/20261231002600_photo_storage.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/photo_storage.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- s1 an editor who uploads, s2 another teacher who copies, s3 an admin.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000005a1', 'ps-editor@example.com', '{"first_name": "Ps", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000005a2', 'ps-teacher@example.com', '{"first_name": "Ps", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000005a3', 'ps-admin@example.com', '{"first_name": "Ps", "last_name": "Admin"}');
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000005a1');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000005a3');

-- f(x): a photo address (a fingerprint of 64 x's, x a hex letter).
create function pg_temp.f(x text) returns text language sql as $$
  select 'https://images.quizmatter.com/uploads/' || repeat(x, 64) || '.webp';
$$;
-- A slide whose only content is a photo with this address.
create function pg_temp.slide_with(src text) returns jsonb language sql as $$
  select jsonb_build_object('id', 's', 'type', 'blank', 'elements',
    jsonb_build_array(jsonb_build_object('id', 'e1', 'src', src)));
$$;

-- s1 uploaded a (1000 bytes) an hour ago, and it's in s1's "My photos".
insert into public.photo_uploads (user_id, src, bytes, created_at)
values ('00000000-0000-4000-8000-0000000005a1', pg_temp.f('a'), 1000, now() - interval '1 hour');
insert into public.photos (user_id, src, width, height)
values ('00000000-0000-4000-8000-0000000005a1', pg_temp.f('a'), 10, 10);

-- ─── The limit ────────────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if public.photo_storage_limit() <> 52428800 then
    raise exception 'FAIL: the limit is %, not 52428800 (50 MB)', public.photo_storage_limit();
  end if;
end;
$$;

-- ─── Counted in "My photos" and on own slides, once ───────────────────────────────────────────────────────────
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 1000 then
    raise exception 'FAIL: a photo in My photos counts %, not 1000', public.photo_storage_used('00000000-0000-4000-8000-0000000005a1');
  end if;
end;
$$;

-- On two of s1's slides too (a presentation with slides at positions 0 and 1): still once.
insert into public.presentations (id, owner_id, title)
values ('test-ps-p1', '00000000-0000-4000-8000-0000000005a1', 'Weather Quiz');
insert into public.slides (presentation_id, id, position, data) values
  ('test-ps-p1', 's0', 0, '{"id": "s0", "type": "blank", "elements": []}'::jsonb),
  ('test-ps-p1', 's1', 1, pg_temp.slide_with(pg_temp.f('a'))),
  ('test-ps-p1', 's2', 2, pg_temp.slide_with(pg_temp.f('a')));

do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 1000 then
    raise exception 'FAIL: a photo in My photos and on 2 slides counts %, not once', public.photo_storage_used('00000000-0000-4000-8000-0000000005a1');
  end if;
end;
$$;

-- Out of "My photos", still on the slides: still counts.
delete from public.photos where user_id = '00000000-0000-4000-8000-0000000005a1' and src = pg_temp.f('a');
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 1000 then
    raise exception 'FAIL: a photo only on own slides should still count';
  end if;
end;
$$;

-- s2 copied the presentation: it's on s2's slides, but s2 didn't upload it.
insert into public.presentations (id, owner_id, title)
values ('test-ps-copy', '00000000-0000-4000-8000-0000000005a2', 'Copy of Weather Quiz');
insert into public.slides (presentation_id, id, position, data)
values ('test-ps-copy', 's1', 0, pg_temp.slide_with(pg_temp.f('a')));
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a2') <> 0 then
    raise exception 'FAIL: a copied photo counts for the teacher who copied it';
  end if;
end;
$$;

-- A shared copy changes only through share_presentation: this setup takes its flag (until the rollback).
select set_config('quizmatter.sharing', 'yes', true);

-- s1's shared copy (same owner, shared_from set) has it; the original no longer does: still counts.
insert into public.presentations (id, owner_id, title, shared_from, is_published)
values ('test-ps-shared', '00000000-0000-4000-8000-0000000005a1', 'Weather Quiz', 'test-ps-p1', true);
insert into public.slides (presentation_id, id, position, data)
values ('test-ps-shared', 's1', 0, pg_temp.slide_with(pg_temp.f('a')));
delete from public.slides where presentation_id = 'test-ps-p1' and id in ('s1', 's2');
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 1000 then
    raise exception 'FAIL: a photo in the published copy should still count for its owner';
  end if;
end;
$$;

-- Gone from the shared copy too: counts for nobody (s2's copy still uses the file).
delete from public.slides where presentation_id = 'test-ps-shared';
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 0
    or public.photo_storage_used('00000000-0000-4000-8000-0000000005a2') <> 0 then
    raise exception 'FAIL: a photo out of My photos and own slides should count for nobody';
  end if;
end;
$$;

-- ─── An upload in progress holds its space for 10 minutes ─────────────────────────────────────────────────────
insert into public.photo_uploads (user_id, src, bytes)
values ('00000000-0000-4000-8000-0000000005a1', pg_temp.f('b'), 500);
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 500 then
    raise exception 'FAIL: a new upload should hold its space';
  end if;
end;
$$;
update public.photo_uploads set created_at = now() - interval '11 minutes'
where user_id = '00000000-0000-4000-8000-0000000005a1' and src = pg_temp.f('b');
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 0 then
    raise exception 'FAIL: an upload never used should stop counting after 10 minutes';
  end if;
end;
$$;

-- ─── reserve_photo_upload ─────────────────────────────────────────────────────────────────────────────────────
-- a back in s1's "My photos": 1000 used.
insert into public.photos (user_id, src, width, height)
values ('00000000-0000-4000-8000-0000000005a1', pg_temp.f('a'), 10, 10);

-- 24 uploads of 2 MB in progress (held): 1000 + 24 × 2097152 = 50332648 used.
create function pg_temp.fill(target uuid, n int) returns void language sql as $$
  insert into public.photo_uploads (user_id, src, bytes)
  select target, 'https://images.quizmatter.com/uploads/' || md5(target::text || i) || md5(i::text) || '.webp', 2097152
  from generate_series(1, n) i;
$$;
select pg_temp.fill('00000000-0000-4000-8000-0000000005a1', 24);

-- Over the limit: refused, nothing written.
do $$
begin
  perform public.reserve_photo_upload('00000000-0000-4000-8000-0000000005a1', pg_temp.f('c'), 2096153);
  raise exception 'FAIL: an upload past 50 MB was accepted';
exception when sqlstate 'QMSTO' then null;
end;
$$;
do $$
begin
  if exists (select 1 from public.photo_uploads where src = pg_temp.f('c')) then
    raise exception 'FAIL: a refused upload left a record';
  end if;
end;
$$;

-- Exactly up to the limit: fine, and it holds its space.
select public.reserve_photo_upload('00000000-0000-4000-8000-0000000005a1', pg_temp.f('c'), 2096152);
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 52428800 then
    raise exception 'FAIL: expected 52428800 used, got %', public.photo_storage_used('00000000-0000-4000-8000-0000000005a1');
  end if;
end;
$$;

-- Full, but the same file again is free (a is already counted).
select public.reserve_photo_upload('00000000-0000-4000-8000-0000000005a1', pg_temp.f('a'), 1000);
do $$
begin
  if public.photo_storage_used('00000000-0000-4000-8000-0000000005a1') <> 52428800 then
    raise exception 'FAIL: uploading a counted photo again changed the total';
  end if;
end;
$$;

-- An admin skips the limit (but still gets a record).
select pg_temp.fill('00000000-0000-4000-8000-0000000005a3', 25);
select public.reserve_photo_upload('00000000-0000-4000-8000-0000000005a3', pg_temp.f('d'), 2000000);
do $$
begin
  if not exists (select 1 from public.photo_uploads
                 where user_id = '00000000-0000-4000-8000-0000000005a3' and src = pg_temp.f('d')) then
    raise exception 'FAIL: an admin''s upload should be recorded';
  end if;
end;
$$;

-- The holds end (c and the fillers were never used), so s1 is back at 1000.
update public.photo_uploads set created_at = now() - interval '1 hour'
where user_id = '00000000-0000-4000-8000-0000000005a1';

-- ─── As s1 (a teacher): can read only their own records, can't write them ────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000005a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
begin
  if exists (select 1 from public.photo_uploads where user_id <> '00000000-0000-4000-8000-0000000005a1')
    or not exists (select 1 from public.photo_uploads) then
    raise exception 'FAIL: a teacher should read their own upload records only';
  end if;
end;
$$;

do $$
begin
  insert into public.photo_uploads (user_id, src, bytes)
  values ('00000000-0000-4000-8000-0000000005a1', 'https://images.quizmatter.com/uploads/' || repeat('9', 64) || '.webp', 1);
  raise exception 'FAIL: a teacher added an upload record';
exception when insufficient_privilege then null;
end;
$$;

do $$
begin
  delete from public.photo_uploads;
  raise exception 'FAIL: a teacher deleted upload records';
exception when insufficient_privilege then null;
end;
$$;

do $$
begin
  update public.photo_uploads set bytes = 1;
  raise exception 'FAIL: a teacher changed upload records';
exception when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform public.reserve_photo_upload('00000000-0000-4000-8000-0000000005a1', 'x', 1);
  raise exception 'FAIL: a teacher called reserve_photo_upload';
exception when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform public.photo_storage_used('00000000-0000-4000-8000-0000000005a2');
  raise exception 'FAIL: a teacher called photo_storage_used';
exception when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform public.photo_uploads_unknown_sizes();
  raise exception 'FAIL: a teacher called photo_uploads_unknown_sizes';
exception when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform public.set_photo_upload_sizes('{}'::jsonb);
  raise exception 'FAIL: a teacher called set_photo_upload_sizes';
exception when insufficient_privilege then null;
end;
$$;

-- ─── my_photo_storage ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  s jsonb := public.my_photo_storage();
begin
  if s is distinct from '{"used": 1000, "limit": 52428800}'::jsonb then
    raise exception 'FAIL: my_photo_storage gave %', s;
  end if;
end;
$$;

-- ─── remove_my_photo ──────────────────────────────────────────────────────────────────────────────────────────
-- a is in My photos and (again) on slide 2 of "Weather Quiz" (position 1) and slide 1 of its published copy.
reset role;
insert into public.slides (presentation_id, id, position, data) values
  ('test-ps-p1', 's1', 1, pg_temp.slide_with(pg_temp.f('a'))),
  ('test-ps-shared', 's1', 0, pg_temp.slide_with(pg_temp.f('a')));
set local role authenticated;

do $$
declare
  r jsonb := public.remove_my_photo(pg_temp.f('a'), 'if_unused');
begin
  if (r ->> 'removed')::boolean then
    raise exception 'FAIL: if_unused removed a photo still on slides: %', r;
  end if;
  if jsonb_array_length(r -> 'uses') <> 2 then
    raise exception 'FAIL: expected 2 uses, got %', r -> 'uses';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(r -> 'uses') u
    where u ->> 'id' = 'test-ps-p1' and u ->> 'title' = 'Weather Quiz'
      and (u ->> 'is_shared_copy')::boolean = false and u -> 'slides' = '[2]'::jsonb
  ) or not exists (
    select 1 from jsonb_array_elements(r -> 'uses') u
    where u ->> 'id' = 'test-ps-shared' and (u ->> 'is_shared_copy')::boolean and u -> 'slides' = '[1]'::jsonb
  ) then
    raise exception 'FAIL: wrong uses: %', r -> 'uses';
  end if;
  if (r ->> 'bytes')::int <> 1000 or (r ->> 'used')::bigint <> 1000 or (r ->> 'limit')::bigint <> 52428800 then
    raise exception 'FAIL: wrong sizes: %', r;
  end if;
  if not exists (select 1 from public.photos where src = pg_temp.f('a')) then
    raise exception 'FAIL: if_unused deleted the row';
  end if;
end;
$$;

-- 'remove' takes it off the list; it still counts (on slides).
do $$
declare
  r jsonb := public.remove_my_photo(pg_temp.f('a'), 'remove');
begin
  if not (r ->> 'removed')::boolean or exists (select 1 from public.photos where src = pg_temp.f('a'))
    or (r ->> 'used')::bigint <> 1000 then
    raise exception 'FAIL: remove: %', r;
  end if;
end;
$$;

-- b: in My photos, on no slide. 'ask' never deletes; 'if_unused' does.
reset role;
insert into public.photos (user_id, src, width, height)
values ('00000000-0000-4000-8000-0000000005a1', pg_temp.f('b'), 10, 10);
set local role authenticated;
do $$
declare
  asked jsonb := public.remove_my_photo(pg_temp.f('b'), 'ask');
  removed jsonb;
begin
  if (asked ->> 'removed')::boolean or asked -> 'uses' <> '[]'::jsonb
    or not exists (select 1 from public.photos where src = pg_temp.f('b')) then
    raise exception 'FAIL: ask: %', asked;
  end if;
  removed := public.remove_my_photo(pg_temp.f('b'), 'if_unused');
  if not (removed ->> 'removed')::boolean or exists (select 1 from public.photos where src = pg_temp.f('b')) then
    raise exception 'FAIL: if_unused on an unused photo: %', removed;
  end if;
end;
$$;

do $$
begin
  perform public.remove_my_photo(pg_temp.f('b'), 'x');
  raise exception 'FAIL: a wrong mode was accepted';
exception when sqlstate '22023' then null;
end;
$$;

-- A photo in a presentation waiting for QuizMatter can't be removed (QMPHL, as before).
reset role;
insert into public.photos (user_id, src, width, height)
values ('00000000-0000-4000-8000-0000000005a1', pg_temp.f('0'), 10, 10);
insert into public.presentations (id, owner_id, title)
values ('test-ps-sub', '00000000-0000-4000-8000-0000000005a1', 'Sent');
insert into public.slides (presentation_id, id, position, data)
values ('test-ps-sub', 's1', 0, pg_temp.slide_with(pg_temp.f('0')));
insert into public.presentation_submissions (presentation_id, submitter_id, status)
values ('test-ps-sub', '00000000-0000-4000-8000-0000000005a1', 'submitted');
set local role authenticated;
do $$
begin
  perform public.remove_my_photo(pg_temp.f('0'), 'remove');
  raise exception 'FAIL: a photo waiting for QuizMatter was removed';
exception when sqlstate 'QMPHL' then null;
end;
$$;

-- ─── As the admin: no limit ───────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000005a3', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$
begin
  if public.my_photo_storage() ->> 'limit' is not null then
    raise exception 'FAIL: an admin got a limit: %', public.my_photo_storage();
  end if;
end;
$$;

-- ─── Size fixes (the weekly cleanup, secret key) ──────────────────────────────────────────────────────────────
reset role;
update public.photo_uploads set bytes = 2097152, size_known = false
where src = pg_temp.f('a');
do $$
begin
  if array(select public.photo_uploads_unknown_sizes() order by 1) <> array[pg_temp.f('a')] then
    raise exception 'FAIL: unknown sizes: %', array(select public.photo_uploads_unknown_sizes());
  end if;
end;
$$;
select public.set_photo_upload_sizes(jsonb_build_object(pg_temp.f('a'), 1234));
do $$
begin
  if exists (select 1 from public.photo_uploads where src = pg_temp.f('a') and (bytes <> 1234 or not size_known))
    or exists (select public.photo_uploads_unknown_sizes()) then
    raise exception 'FAIL: set_photo_upload_sizes did not fix the size';
  end if;
end;
$$;

rollback;
