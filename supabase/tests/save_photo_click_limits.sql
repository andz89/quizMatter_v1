-- Saving presentations, uploading photos, folders and settings use the click limit system
-- (supabase/migrations/20261211000000_save_photo_click_limits.sql): 30 in a minute pauses it for 10 minutes (1 hour
-- if again within 24 hours), and the 3rd time in a row bans. Saves and uploads also have a daily limit (1,000 and
-- 300), and so do photos sent by hand, folders and settings (300, 500, 500), which pauses until midnight. Size
-- limits never pause.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/save_photo_click_limits.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- c1 teacher (a script saving), c2 banned teacher, c3 teacher (100 slides), c4 teacher (photo uploads),
-- c5 teacher (photos straight to the table), c6 super admin, c7 teacher (a day of saves and uploads),
-- c8 teacher (folders), c9 teacher (settings), ca teacher (a day of photo rows, folders and settings).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000ca', 'spc-slow@example.com', '{"first_name": "Spc", "last_name": "Slow"}'),
  ('00000000-0000-4000-8000-0000000000c7', 'spc-daily@example.com', '{"first_name": "Spc", "last_name": "Daily"}'),
  ('00000000-0000-4000-8000-0000000000c8', 'spc-folders@example.com', '{"first_name": "Spc", "last_name": "Folders"}'),
  ('00000000-0000-4000-8000-0000000000c9', 'spc-settings@example.com', '{"first_name": "Spc", "last_name": "Settings"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'spc-script@example.com', '{"first_name": "Spc", "last_name": "Script"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'spc-banned@example.com', '{"first_name": "Spc", "last_name": "Banned"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'spc-slides@example.com', '{"first_name": "Spc", "last_name": "Slides"}'),
  ('00000000-0000-4000-8000-0000000000c4', 'spc-upload@example.com', '{"first_name": "Spc", "last_name": "Upload"}'),
  ('00000000-0000-4000-8000-0000000000c5', 'spc-rows@example.com', '{"first_name": "Spc", "last_name": "Rows"}'),
  ('00000000-0000-4000-8000-0000000000c6', 'spc-super@example.com', '{"first_name": "Spc", "last_name": "Super"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000c6', true);
insert into public.banned_users (user_id, reason) values ('00000000-0000-4000-8000-0000000000c2', 'Test ban');
insert into public.presentations (id, owner_id, title) values
  ('test-spc-script', '00000000-0000-4000-8000-0000000000c1', 'Script'),
  ('test-spc-banned', '00000000-0000-4000-8000-0000000000c2', 'Banned teacher''s'),
  ('test-spc-slides', '00000000-0000-4000-8000-0000000000c3', 'Slides'),
  ('test-spc-super', '00000000-0000-4000-8000-0000000000c6', 'Super admin''s'),
  ('test-spc-daily', '00000000-0000-4000-8000-0000000000c7', 'Daily'),
  ('test-spc-f1', '00000000-0000-4000-8000-0000000000c8', 'Folder one'),
  ('test-spc-f2', '00000000-0000-4000-8000-0000000000c8', 'Folder two');
insert into public.folders (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-0000000000c8', 'Week 1'),
  ('00000000-0000-4000-8000-0000000000fa', '00000000-0000-4000-8000-0000000000ca', 'Week 1');

-- ─── 1. A script saving 30 times in a minute is paused for 10 minutes ─────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c1', 'role', 'authenticated')::text, true);

-- Each save is its own request in real life: the "already counted" flag starts empty. The 30th still goes through.
do $$
begin
  for n in 1..30 loop
    perform set_config('quizmatter.write_counted', '', true);
    update public.presentations set title = 'Save ' || n where id = 'test-spc-script';
  end loop;
end $$;

do $$
begin
  perform set_config('quizmatter.write_counted', '', true);
  update public.presentations set title = 'Save 31' where id = 'test-spc-script';
  raise exception 'FAIL: a 31st save in one minute went through';
exception when sqlstate 'QMBLK' then
  null;
end $$;

-- Deleting a slide is a save too, so it's paused as well.
do $$
begin
  perform set_config('quizmatter.write_counted', '', true);
  delete from public.slides where presentation_id = 'test-spc-script';
  raise exception 'FAIL: a paused teacher''s delete went through';
exception when sqlstate 'QMBLK' then
  null;
end $$;

reset role;

do $$
begin
  if (select title from public.presentations where id = 'test-spc-script') <> 'Save 30' then
    raise exception 'FAIL: the 30th save didn''t go through';
  end if;
  if not exists (
    select 1 from public.click_rate r
    where r.user_id = '00000000-0000-4000-8000-0000000000c1' and r.feature = 'presentation_save'
      and r.pause_streak = 1 and r.paused_until between now() + interval '9 minutes' and now() + interval '11 minutes'
  ) then
    raise exception 'FAIL: the teacher wasn''t paused for 10 minutes';
  end if;
  if not exists (
    select 1 from public.click_history h
    where h.user_id = '00000000-0000-4000-8000-0000000000c1' and h.feature = 'presentation_save'
      and h.kind = 'pause' and h.pause_minutes = 10
  ) then
    raise exception 'FAIL: the pause isn''t in the history (Admin → Safety)';
  end if;
end $$;

-- ─── 2. The 3rd time in a row bans the teacher ────────────────────────────────────────────────────────────────
-- As if the 2nd pause just ended a minute ago.
update public.click_rate set paused_until = now() - interval '1 minute', pause_streak = 2
where user_id = '00000000-0000-4000-8000-0000000000c1' and feature = 'presentation_save';

set local role authenticated;

do $$
begin
  for n in 1..30 loop
    perform set_config('quizmatter.write_counted', '', true);
    update public.presentations set title = 'Again ' || n where id = 'test-spc-script';
  end loop;
end $$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.banned_users b
    where b.user_id = '00000000-0000-4000-8000-0000000000c1' and b.is_automatic
  ) then
    raise exception 'FAIL: the 3rd time in a row didn''t ban the teacher';
  end if;
  if not exists (
    select 1 from public.click_history h
    where h.user_id = '00000000-0000-4000-8000-0000000000c1' and h.feature = 'presentation_save' and h.kind = 'ban'
  ) then
    raise exception 'FAIL: the ban isn''t in the history';
  end if;
end $$;

-- ─── 3. A banned teacher can't save at all ────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c2', 'role', 'authenticated')::text, true);

do $$
begin
  perform set_config('quizmatter.write_counted', '', true);
  update public.presentations set title = 'Still here' where id = 'test-spc-banned';
  raise exception 'FAIL: a banned teacher saved';
exception when sqlstate 'QMBAN' then
  null;
end $$;

-- ─── 4. One save counts once, and the 100-slide limit never pauses ────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c3', 'role', 'authenticated')::text, true);
select set_config('quizmatter.write_counted', '', true);

-- 100 slides in one save.
insert into public.slides (presentation_id, id, position, data)
select 'test-spc-slides', 's' || n, n - 1, jsonb_build_object('id', 's' || n, 'type', 'blank')
from generate_series(1, 100) as n;

do $$
begin
  perform set_config('quizmatter.write_counted', '', true);
  insert into public.slides (presentation_id, id, position, data)
  values ('test-spc-slides', 's101', 100, '{"id": "s101", "type": "blank"}');
  raise exception 'FAIL: a 101st slide was added';
exception when invalid_parameter_value then
  null;
end $$;

reset role;

do $$
begin
  if (select r.clicks from public.click_rate r
      where r.user_id = '00000000-0000-4000-8000-0000000000c3' and r.feature = 'presentation_save') is distinct from 1 then
    raise exception 'FAIL: one save of 100 slides wasn''t counted once';
  end if;
  if exists (
    select 1 from public.click_rate r
    where r.user_id = '00000000-0000-4000-8000-0000000000c3' and r.paused_until is not null
  ) then
    raise exception 'FAIL: reaching 100 slides paused the teacher';
  end if;
end $$;

-- ─── 5. Uploading 30 photos in a minute pauses uploads (src/app/api/upload-image) ─────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c4', 'role', 'authenticated')::text, true);

do $$
begin
  for n in 1..30 loop
    perform public.count_photo_upload();
  end loop;
end $$;

do $$
begin
  perform public.count_photo_upload();
  raise exception 'FAIL: a 31st photo upload in one minute went through';
exception when sqlstate 'QMBLK' then
  null;
end $$;

-- ─── 6. Photos written straight to the table: 30 in a minute pauses it too ────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c5', 'role', 'authenticated')::text, true);

insert into public.photos (src, width, height)
select 'https://images.quizmatter.com/uploads/test-spc-' || n || '.webp', 10, 10
from generate_series(1, 30) as n;

do $$
begin
  insert into public.photos (src, width, height)
  values ('https://images.quizmatter.com/uploads/test-spc-31.webp', 10, 10);
  raise exception 'FAIL: a 31st photo in one minute was added straight to the table';
exception when sqlstate 'QMBLK' then
  null;
end $$;

-- ─── 7. The super admin isn't counted ─────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c6', 'role', 'authenticated')::text, true);

do $$
begin
  for n in 1..40 loop
    perform set_config('quizmatter.write_counted', '', true);
    update public.presentations set title = 'Super ' || n where id = 'test-spc-super';
  end loop;
end $$;

reset role;

do $$
begin
  if exists (select 1 from public.click_rate r where r.user_id = '00000000-0000-4000-8000-0000000000c6') then
    raise exception 'FAIL: the super admin''s saves were counted';
  end if;
  if not exists (
    select 1 from public.click_rate r
    where r.user_id = '00000000-0000-4000-8000-0000000000c4' and r.feature = 'photo_upload' and r.paused_until > now()
  ) or not exists (
    select 1 from public.click_rate r
    where r.user_id = '00000000-0000-4000-8000-0000000000c5' and r.feature = 'photo_rows' and r.paused_until > now()
  ) then
    raise exception 'FAIL: photo uploads weren''t paused';
  end if;
end $$;

-- ─── 8. A slow script: the 1,000th save of the day (and the 300th upload) pauses until midnight ───────────────
-- As if the teacher had already saved 999 times and uploaded 299 photos today, slowly enough for the minute limit.
insert into public.click_rate (user_id, feature, window_start, clicks) values
  ('00000000-0000-4000-8000-0000000000c7', 'presentation_save_daily', now(), 999),
  ('00000000-0000-4000-8000-0000000000c7', 'photo_upload_daily', now(), 299);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c7', 'role', 'authenticated')::text, true);

-- The 1,000th save and the 300th upload still go through.
select set_config('quizmatter.write_counted', '', true);
update public.presentations set title = 'Save 1000' where id = 'test-spc-daily';
select public.count_photo_upload();

do $$
begin
  perform set_config('quizmatter.write_counted', '', true);
  update public.presentations set title = 'Save 1001' where id = 'test-spc-daily';
  raise exception 'FAIL: a 1,001st save in one day went through';
exception when sqlstate 'QMBLK' then
  null;
end $$;

do $$
begin
  perform public.count_photo_upload();
  raise exception 'FAIL: a 301st photo upload in one day went through';
exception when sqlstate 'QMBLK' then
  null;
end $$;

reset role;

do $$
declare
  midnight timestamptz := ((now() at time zone 'Asia/Manila')::date + 1)::timestamp at time zone 'Asia/Manila';
begin
  if (select title from public.presentations where id = 'test-spc-daily') <> 'Save 1000' then
    raise exception 'FAIL: the 1,000th save of the day didn''t go through';
  end if;
  if (select count(*) from public.click_rate r
      where r.user_id = '00000000-0000-4000-8000-0000000000c7'
        and r.feature in ('presentation_save_daily', 'photo_upload_daily') and r.paused_until = midnight) <> 2 then
    raise exception 'FAIL: the daily limits didn''t pause until midnight (Philippine time)';
  end if;
end $$;

-- ─── 9. Folders: 30 changes in a minute pauses them; moving many presentations at once counts once ────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c8', 'role', 'authenticated')::text, true);

-- One request: both presentations into the folder.
select set_config('quizmatter.counted_folders', '', true);
insert into public.folder_items (presentation_id, folder_id) values
  ('test-spc-f1', '00000000-0000-4000-8000-0000000000f8'),
  ('test-spc-f2', '00000000-0000-4000-8000-0000000000f8');

reset role;

do $$
begin
  if (select r.clicks from public.click_rate r
      where r.user_id = '00000000-0000-4000-8000-0000000000c8' and r.feature = 'folders') is distinct from 1 then
    raise exception 'FAIL: moving two presentations in one request wasn''t counted once';
  end if;
end $$;

set local role authenticated;

-- 29 renames more: the 30th change still goes through.
do $$
begin
  for n in 1..29 loop
    perform set_config('quizmatter.counted_folders', '', true);
    update public.folders set name = 'Week ' || (n + 1) where id = '00000000-0000-4000-8000-0000000000f8';
  end loop;
end $$;

do $$
begin
  perform set_config('quizmatter.counted_folders', '', true);
  delete from public.folder_items where presentation_id = 'test-spc-f1';
  raise exception 'FAIL: a 31st folder change in one minute went through';
exception when sqlstate 'QMBLK' then
  null;
end $$;

-- ─── 10. Settings: 30 changes in a minute pauses them; the display name has its own limit ─────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000c9', 'role', 'authenticated')::text, true);

-- set_display_name (a database function) is counted by the display_name limit only.
select set_config('quizmatter.counted_settings', '', true);
select public.set_display_name(name => 'Spc Settings');

do $$
begin
  for n in 1..30 loop
    perform set_config('quizmatter.counted_settings', '', true);
    update public.user_settings set bio = 'Bio ' || n where user_id = '00000000-0000-4000-8000-0000000000c9';
  end loop;
end $$;

do $$
begin
  perform set_config('quizmatter.counted_settings', '', true);
  update public.user_settings set bio = 'Bio 31' where user_id = '00000000-0000-4000-8000-0000000000c9';
  raise exception 'FAIL: a 31st settings change in one minute went through';
exception when sqlstate 'QMBLK' then
  null;
end $$;

reset role;

do $$
begin
  if (select bio from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000c9') <> 'Bio 30' then
    raise exception 'FAIL: the 30th settings change didn''t go through';
  end if;
  if not exists (
    select 1 from public.click_rate r
    where r.user_id = '00000000-0000-4000-8000-0000000000c9' and r.feature = 'display_name' and r.clicks = 1
  ) then
    raise exception 'FAIL: setup: the display name change wasn''t counted';
  end if;
end $$;

-- ─── 11. A slow script on photo rows, folders and settings: the daily limit pauses until midnight ─────────────
-- As if the teacher had already sent 299 photo rows, 499 folder changes and 499 settings changes today.
insert into public.click_rate (user_id, feature, window_start, clicks) values
  ('00000000-0000-4000-8000-0000000000ca', 'photo_rows_daily', now(), 299),
  ('00000000-0000-4000-8000-0000000000ca', 'folders_daily', now(), 499),
  ('00000000-0000-4000-8000-0000000000ca', 'settings_daily', now(), 499);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000ca', 'role', 'authenticated')::text, true);

-- The last one of the day still goes through…
select set_config('quizmatter.counted_folders', '', true);
select set_config('quizmatter.counted_settings', '', true);
insert into public.photos (src, width, height) values ('https://images.quizmatter.com/uploads/test-spc-slow-1.webp', 10, 10);
update public.folders set name = 'Week 2' where id = '00000000-0000-4000-8000-0000000000fa';
update public.user_settings set bio = 'Last' where user_id = '00000000-0000-4000-8000-0000000000ca';

-- …and the next one is refused.
do $$
declare
  step text;
begin
  foreach step in array array[
    $s$insert into public.photos (src, width, height)
       values ('https://images.quizmatter.com/uploads/test-spc-slow-2.webp', 10, 10)$s$,
    $s$update public.folders set name = 'Week 3' where id = '00000000-0000-4000-8000-0000000000fa'$s$,
    $s$update public.user_settings set bio = 'One more' where user_id = '00000000-0000-4000-8000-0000000000ca'$s$
  ] loop
    begin
      perform set_config('quizmatter.counted_folders', '', true);
      perform set_config('quizmatter.counted_settings', '', true);
      execute step;
      raise exception 'FAIL: a write past the daily limit went through: %', step;
    exception when sqlstate 'QMBLK' then
      null;
    end;
  end loop;
end $$;

reset role;

do $$
declare
  midnight timestamptz := ((now() at time zone 'Asia/Manila')::date + 1)::timestamp at time zone 'Asia/Manila';
begin
  if (select count(*) from public.click_rate r
      where r.user_id = '00000000-0000-4000-8000-0000000000ca'
        and r.feature in ('photo_rows_daily', 'folders_daily', 'settings_daily') and r.paused_until = midnight) <> 3 then
    raise exception 'FAIL: the daily limits for photo rows, folders and settings didn''t pause until midnight';
  end if;
end $$;

rollback;
