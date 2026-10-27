-- Saving presentations, uploading photos, folders and settings join the one click limit system
-- (20261013000000_click_limits.sql). Before, saves and uploads were only refused until the minute was over
-- (count_write, QM429), so a script that waited a little kept going all day and nobody knew, and folders and
-- settings had no speed limit at all. Now 30 in a minute pauses it for 10 minutes (1 hour if again within 24 hours),
-- the 3rd time in a row bans (is_automatic), and every pause and ban is in Admin → Safety, like bookmarks.
--
-- 1. presentation_save: every write to a teacher's presentations or slides (the editor's save, a delete, a copy,
--    sharing, or requests sent by hand), counted once per request (count_presentation_write).
-- 2. photo_upload: the app's photo upload (src/app/api/upload-image calls count_photo_upload before the file is
--    stored). Admins adding shared photos keep count_write('photos'): they add many at once, and admins are never
--    banned.
-- 3. photo_rows: photos written straight to the table (count_photo_write), each row once.
-- 4. Daily: presentation_save_daily (1,000 saves), photo_upload_daily (300 uploads), photo_rows_daily (300 rows),
--    folders_daily and settings_daily (500 changes each), so a slow script that stays under 30 a minute is stopped
--    too. Reaching one pauses until midnight (Philippine time); 3 days in a row bans.
-- 5. folders (folders and folder_items) and settings (user_settings): the teacher's own requests, once per request
--    (count_table_write). Not the database's own functions: set_display_name has its own limit (display_name).
-- Size limits (100 slides, 50 presentations, …) and refusals like an old tab or a review lock stay plain refusals:
-- they never pause or ban. count_click skips the super admin and never bans a plain admin.
-- Keep the features the same as CLICK_FEATURES in src/lib/clickLimits.ts.

insert into public.click_limits
  (feature, label, max_clicks, per_seconds, first_pause_minutes, repeat_pause_minutes, repeat_within_hours, ban_after_pauses)
values
  ('presentation_save', 'Save (presentations)', 30, 60, 10, 60, 24, 3),
  ('photo_upload', 'Photo uploads', 30, 60, 10, 60, 24, 3),
  ('photo_rows', 'Photos sent by hand', 30, 60, 10, 60, 24, 3),
  ('folders', 'Folders', 30, 60, 10, 60, 24, 3),
  ('settings', 'Settings', 30, 60, 10, 60, 24, 3);

insert into public.click_limits
  (feature, label, max_clicks, per_seconds, first_pause_minutes, repeat_pause_minutes, repeat_within_hours, ban_after_pauses, daily_reset_time_zone)
values
  ('presentation_save_daily', 'Save (presentations), daily', 1000, 86400, 1440, 1440, 24, 3, 'Asia/Manila'),
  ('photo_upload_daily', 'Photo uploads, daily', 300, 86400, 1440, 1440, 24, 3, 'Asia/Manila'),
  ('photo_rows_daily', 'Photos sent by hand, daily', 300, 86400, 1440, 1440, 24, 3, 'Asia/Manila'),
  ('folders_daily', 'Folders, daily', 500, 86400, 1440, 1440, 24, 3, 'Asia/Manila'),
  ('settings_daily', 'Settings, daily', 500, 86400, 1440, 1440, 24, 3, 'Asia/Manila');

-- count_presentation_write: same as before (20261210000300_direct_write_limits.sql), but it counts the click limits
-- instead of count_write. A banned teacher is still refused here (count_write checked that; count_click doesn't).
-- "create or replace" keeps both triggers (presentations, slides).
create or replace function public.count_presentation_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  if coalesce(current_setting('quizmatter.write_counted', true), '') <> 'yes' then
    perform set_config('quizmatter.write_counted', 'yes', true);
    if public.is_banned() then
      raise exception 'This account is banned.' using errcode = 'QMBAN';
    end if;
    perform public.count_click('presentation_save');
    perform public.count_click('presentation_save_daily');
  end if;
  return null;
end;
$$;

-- count_photo_write: same as before (20261210000300_direct_write_limits.sql), with the click limit and the ban
-- check, like count_presentation_write. "create or replace" keeps the trigger.
create or replace function public.count_photo_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if public.is_banned() then
      raise exception 'This account is banned.' using errcode = 'QMBAN';
    end if;
    perform public.count_click('photo_rows');
    perform public.count_click('photo_rows_daily');
  end if;
  return new;
end;
$$;

-- One photo upload (src/app/api/upload-image), counted before the file is stored: the minute and the daily limit
-- in one request, so a refusal from either counts neither.
create function public.count_photo_upload()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.count_click('photo_upload');
  perform public.count_click('photo_upload_daily');
end;
$$;

revoke execute on function public.count_photo_upload() from public, anon;
grant execute on function public.count_photo_upload() to authenticated;

-- Folders and settings: counts the click limit named by the trigger and its daily one ('<feature>_daily'), once per
-- request (each feature has its own "already counted" flag). Only the teacher's own requests: not the database's
-- functions, and not an account delete (no logged-in user; it runs as supabase_auth_admin, which can't run
-- count_click).
create function public.count_table_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  feature text := tg_argv[0];
  flag text := 'quizmatter.counted_' || tg_argv[0];
begin
  if auth.uid() is null or current_user <> 'authenticated' then
    return null;
  end if;
  if coalesce(current_setting(flag, true), '') <> 'yes' then
    perform set_config(flag, 'yes', true);
    perform public.count_click(feature);
    perform public.count_click(feature || '_daily');
  end if;
  return null;
end;
$$;

create trigger count_folder_write
  after insert or update or delete on public.folders
  for each statement execute function public.count_table_write('folders');

create trigger count_folder_item_write
  after insert or update or delete on public.folder_items
  for each statement execute function public.count_table_write('folders');

create trigger count_settings_write
  after insert or update on public.user_settings
  for each statement execute function public.count_table_write('settings');
