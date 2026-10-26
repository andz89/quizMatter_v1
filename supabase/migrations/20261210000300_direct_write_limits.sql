-- Limits on direct table writes, and small speed fixes (fixes from the 2026-10-24 review, D9, D11, D12).
--
-- The app's own paths check speed limits, bans and caps inside database functions, but a logged-in teacher can
-- also write some tables straight through the API and skip those checks. The triggers below give those direct
-- writes the same limits. They act only when current_user = 'authenticated' (a write straight from the API, or
-- from save_presentation, which runs as the caller): the database's own security definer functions (sharing,
-- reviews, submissions, sign-up) run as their owner and pass, as before.
--
-- 1. photos: every new row counts toward a speed limit of its own (count_write 'photo_rows': 30 a minute; banned
--    accounts get QMBAN). The upload route already counts 'photos' before the file is stored, so the row has its
--    own counter and one upload isn't counted twice. No cap on the number of rows: the app has none.
-- 2. slides: at most 100 per presentation, however they're written. (Speed and bans are already counted for every
--    slides write, by count_slide_write.)
-- 3. presentation_reports, user_settings, folder_items: a banned account can't add or change rows (QMBAN).
-- 4. A new folder is counted under a lock, so two at the same moment can't both pass the 50-folder limit.
-- 5. Speed: the admin log's read policy asks is_super_admin() once per query, not once per row; an index for
--    log_ban's lookup by target_id.
-- 6. Helpers that logged-out visitors (anon) never need can't be run by them any more.
-- 7. Deleting an account from Supabase (the dashboard's "Delete user", the Auth API) works again: the write
--    counter no longer runs when there's no logged-in user.

-- ─── 1. Photos written straight to the table ──────────────────────────────────────────────────────────────────
-- count_write: same as before (20261122000000_super_admin.sql); only the kind 'photo_rows' is new.
-- "create or replace" keeps who may run it.
create or replace function public.count_write(kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  user_writes int;
begin
  if count_write.kind not in ('presentations', 'photos', 'saved', 'photo_rows') then
    raise exception 'Unknown kind of write.' using errcode = '22023';
  end if;
  if auth.uid() is null or public.is_super_admin() then
    return;
  end if;
  if exists (select 1 from public.banned_users where user_id = auth.uid()) then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;

  insert into public.write_rate as w (user_id, kind, window_start, writes)
  values (auth.uid(), count_write.kind, now(), 1)
  on conflict (user_id, kind) do update set
    window_start = case when w.window_start < now() - interval '1 minute' then now() else w.window_start end,
    writes = case when w.window_start < now() - interval '1 minute' then 1 else w.writes + 1 end
  returning w.writes into user_writes;

  if user_writes > 30 then
    raise exception 'Too many saves. Wait a minute and try again.' using errcode = 'QM429';
  end if;
end;
$$;

-- Each photos row added through the API counts once (an upload's "insert … on conflict" too, like its 'photos'
-- count in the upload route). Same 30 a minute as WRITES_PER_MINUTE in src/lib/schema.ts.
create function public.count_photo_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    perform public.count_write('photo_rows');
  end if;
  return new;
end;
$$;

create trigger count_photo_write
  before insert on public.photos
  for each row execute function public.count_photo_write();

-- ─── 2. At most 100 slides per presentation ───────────────────────────────────────────────────────────────────
-- Same limit as MAX_SLIDES in src/lib/schema.ts (save_presentation checks it first for the app's saves). Rows
-- added earlier in the same insert count too. Moving a slide to another presentation counts as adding it there.
create function public.check_slide_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'authenticated'
    or (tg_op = 'UPDATE' and new.presentation_id = old.presentation_id)
    -- save_presentation's "insert … on conflict do update" runs this for slides already saved too: those are only
    -- being saved again, not added.
    or exists (select 1 from public.slides s where s.presentation_id = new.presentation_id and s.id = new.id) then
    return new;
  end if;
  -- Two writes to the same presentation at the same moment wait for each other, so both are counted (the same
  -- lock save_presentation takes).
  perform 1 from public.presentations p where p.id = new.presentation_id for update;
  if (select count(*) from public.slides s where s.presentation_id = new.presentation_id) >= 100 then
    raise exception 'A presentation can have at most 100 slides.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger slide_limit
  before insert or update of presentation_id on public.slides
  for each row execute function public.check_slide_limit();

-- ─── 3. Banned accounts can't report, change their settings or file presentations ─────────────────────────────
create function public.refuse_banned_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  return new;
end;
$$;

create trigger refuse_banned_write
  before insert or update on public.presentation_reports
  for each row execute function public.refuse_banned_write();

create trigger refuse_banned_write
  before insert or update on public.user_settings
  for each row execute function public.refuse_banned_write();

create trigger refuse_banned_write
  before insert or update on public.folder_items
  for each row execute function public.refuse_banned_write();

-- ─── 4. The folder limit counts under a lock ──────────────────────────────────────────────────────────────────
-- check_folder_limit: same as before (20261028000000_folders.sql); only the lock is new. It's the same lock a new
-- presentation takes (check_presentation_limit), so a teacher's new folder and new presentation wait for each other
-- for a moment, which is harmless. "create or replace" keeps the trigger.
create or replace function public.check_folder_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  -- Two new folders from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  if (select count(*) from public.folders f where f.owner_id = new.owner_id) >= 50 then
    raise exception 'You have 50 folders, the most allowed.' using errcode = 'QMFLD';
  end if;
  return new;
end;
$$;

-- ─── 5. The admin log: faster reads and ban logs ──────────────────────────────────────────────────────────────
-- "(select …)" makes the database ask is_super_admin() once for the whole read, not once for every row.
alter policy "Super admin reads the admin log" on public.admin_actions
  using ((select public.is_super_admin()));

-- log_ban looks up the teacher's latest ban row by target_id.
create index admin_actions_target_id on public.admin_actions (target_id);

-- ─── 6. Helpers that logged-out visitors don't need ───────────────────────────────────────────────────────────
-- None is called by a logged-out page: the app only reads the tags_text and profile_slug columns (worked out when a
-- row is saved), and Claude's photo search calls search_shared_photos with the secret key (service_role). anon also
-- had them through "public" (every role), so both are revoked. Logged-in users keep them: saving a presentation or
-- settings fills those columns, and save_presentation (which runs as the caller) uses grades_from.
-- search_shared_photos was already only for service_role (20260929030000_shared_photo_source.sql); it stays so.
revoke execute on function public.search_shared_photos(text) from public, anon;

revoke execute on function
  public.grades_from(jsonb), public.profile_slug(text), public.tags_text(text[]), public.slide_photo_srcs(jsonb)
  from public, anon;
grant execute on function
  public.grades_from(jsonb), public.profile_slug(text), public.tags_text(text[]), public.slide_photo_srcs(jsonb)
  to authenticated;

-- ─── 7. Supabase can delete accounts ──────────────────────────────────────────────────────────────────────────
-- Supabase deletes an account as its own role, supabase_auth_admin, which can't run count_write. The account's
-- presentations and slides go with it ("on delete cascade"), and the write counter below (an "after" trigger) then
-- runs as that role, so calling count_write stopped the whole delete ("permission denied"). With no logged-in user
-- there is nobody to count (count_write skips them too), so it now returns first. Every other trigger an account
-- delete reaches runs as the database: it is security definer, or a "before" trigger, which inside the cascade runs
-- as the table's owner (test: supabase/tests/account_delete.sql).
-- count_presentation_write: same as before (20261001010000_limits_and_reports.sql); only the first check is new.
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
    perform public.count_write('presentations');
  end if;
  return null;
end;
$$;
