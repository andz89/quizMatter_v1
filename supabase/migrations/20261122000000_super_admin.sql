-- Super admin and plain admins (docs/superpowers/specs/2026-10-16-super-admin-design.md).
-- One admin is the super admin and can do everything. Every other admin is a plain admin: still an admin
-- (is_admin() is true), but can't manage teachers, safety or the photo cleanup, only manages the shared photos
-- they uploaded, and follows the speed limits like a teacher. Every admin still skips the 50-presentation limit,
-- because approving a submission makes a copy the approving admin owns.

-- ─── 1. The super admin ─────────────────────────────────────────────────────────────────────────────────────
alter table public.admins add column is_super boolean not null default false;

update public.admins set is_super = true
where user_id = (select id from auth.users where email = 'andzrivero89@gmail.com');

-- Stop here if that account isn't an admin: else nobody would be super admin.
do $$
begin
  if not exists (select 1 from public.admins where is_super) and not exists (select 1 from auth.users) then
    raise notice 'No users yet (fresh local database), so no super admin was set.';
  elsif not exists (select 1 from public.admins where is_super) then
    raise exception 'andzrivero89@gmail.com is not in public.admins, so no super admin was set.';
  end if;
end;
$$;

-- True when the logged-in user is the super admin. "security definer" lets it read the admins table.
create function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()) and is_super);
$$;

revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- ─── 2. Shared photos: who uploaded each one ────────────────────────────────────────────────────────────────
-- Filled by the database for uploads from Admin → Photos, and by claude-photo (from the ticket) for Claude's.
-- The photos shared before this were all uploaded by the super admin.
alter table public.shared_photos
  add column uploaded_by uuid default auth.uid() references auth.users (id) on delete set null;

update public.shared_photos
set uploaded_by = (select user_id from public.admins where is_super limit 1);

-- Same views as in 20261026000000_remove_photo_review.sql, plus uploaded_by (added last, so "create or replace"
-- works). The counts are now one row per category and uploader, so Admin → Photos can count only an admin's own.
create or replace view public.shared_photos_search with (security_invoker = true) as
  select
    sp.src,
    sp.width,
    sp.height,
    sp.category_id,
    sp.file_name,
    sp.description,
    sp.tags,
    sp.source,
    sp.bytes,
    sp.created_at,
    array_to_string(sp.tags, ' ') as tags_text,
    c.name as category_name,
    sp.uploaded_by
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id;

create or replace view public.shared_photo_counts with (security_invoker = true) as
  select
    category_id,
    count(*)::integer as photos,
    (count(*) filter (where description = ''))::integer as no_description,
    (count(*) filter (where source = ''))::integer as no_source,
    uploaded_by
  from public.shared_photos
  group by category_id, uploaded_by;

-- Everyone still reads every shared photo. Any admin adds them (as themselves); the super admin changes or removes
-- any, a plain admin only their own.
drop policy "Admins change shared photos" on public.shared_photos;
create policy "Admins add shared photos" on public.shared_photos
  for insert to authenticated
  with check ((select public.is_admin()) and uploaded_by = (select auth.uid()));
create policy "Owners change shared photos" on public.shared_photos
  for update to authenticated
  using ((select public.is_super_admin()) or ((select public.is_admin()) and uploaded_by = (select auth.uid())))
  with check ((select public.is_super_admin()) or ((select public.is_admin()) and uploaded_by = (select auth.uid())));
create policy "Owners remove shared photos" on public.shared_photos
  for delete to authenticated
  using ((select public.is_super_admin()) or ((select public.is_admin()) and uploaded_by = (select auth.uid())));

-- Any admin makes a new category (when uploading); only the super admin renames or deletes one.
drop policy "Admins change categories" on public.photo_categories;
create policy "Admins add categories" on public.photo_categories
  for insert to authenticated
  with check ((select public.is_admin()));
create policy "Super admin changes categories" on public.photo_categories
  for update to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));
create policy "Super admin removes categories" on public.photo_categories
  for delete to authenticated
  using ((select public.is_super_admin()));

-- ─── 3. Bans and the photo cleanup: super admin only ────────────────────────────────────────────────────────
drop policy "Admins manage bans" on public.banned_users;
create policy "Super admin manages bans" on public.banned_users
  for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

-- Same as before (20260929000000_admin_used_photos.sql), for the super admin only.
create or replace function public.admin_used_photo_srcs()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can see this.' using errcode = '42501';
  end if;
  return public.used_photo_srcs();
end;
$$;

-- ─── 4. Speed limits: only the super admin skips them ───────────────────────────────────────────────────────
-- count_write: same as before (20261012000000_saved_limits.sql); only is_super_admin() is new.
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
  if count_write.kind not in ('presentations', 'photos', 'saved') then
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

-- count_click: same as before (20261105000000_publish_daily_reset.sql); only is_super_admin() is new, and a plain
-- admin is never banned automatically (they get the pause instead).
create or replace function public.count_click(feature text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  lim public.click_limits;
  last_pause timestamptz;
  last_streak int;
  streak int;
  user_clicks int;
  minutes int;
  -- A daily limit's count starts again when the date changes (in its time zone); else after per_seconds.
  is_new_window boolean;
  next_midnight timestamptz;
begin
  if auth.uid() is null or public.is_super_admin() then
    return;
  end if;
  select * into lim from public.click_limits l where l.feature = count_click.feature;
  if not found then
    raise exception 'Unknown feature.' using errcode = '22023';
  end if;

  -- "for update": two clicks at the same moment wait for each other, so both are counted.
  select r.paused_until, r.pause_streak into last_pause, last_streak
  from public.click_rate r
  where r.user_id = auth.uid() and r.feature = count_click.feature
  for update;
  if last_pause > now() then
    raise exception 'Too many clicks. Try again later.'
      using errcode = 'QMBLK', detail = (extract(epoch from last_pause) * 1000)::bigint::text;
  end if;

  select case
      when lim.daily_reset_time_zone is not null
        then (r.window_start at time zone lim.daily_reset_time_zone)::date < (now() at time zone lim.daily_reset_time_zone)::date
      else r.window_start < now() - make_interval(secs => lim.per_seconds)
    end
  into is_new_window
  from public.click_rate r
  where r.user_id = auth.uid() and r.feature = count_click.feature;

  insert into public.click_rate as r (user_id, feature, window_start, clicks)
  values (auth.uid(), count_click.feature, now(), 1)
  on conflict (user_id, feature) do update set
    window_start = case when is_new_window then now() else r.window_start end,
    clicks = case when is_new_window then 1 else r.clicks + 1 end
  returning clicks into user_clicks;

  if user_clicks < lim.max_clicks then
    return;
  end if;

  -- This click reached the limit. It still goes through, so the pause (or ban) is saved with it.
  streak := case
    when last_pause > now() - make_interval(hours => lim.repeat_within_hours) then coalesce(last_streak, 0) + 1
    else 1
  end;

  -- A plain admin is paused like a teacher, but never banned automatically.
  if streak >= lim.ban_after_pauses and not public.is_admin() then
    insert into public.banned_users (user_id, reason, is_automatic)
    values (
      auth.uid(),
      format('Automatic ban: clicked %s too fast %s times, each within %s hours of the last.',
        lim.label, streak, lim.repeat_within_hours),
      true
    )
    on conflict (user_id) do nothing;
    -- Supabase's own ban, like an admin ban (banTeacher): 100 years, so until an admin unbans. Their login stops
    -- working within the hour.
    update auth.users set banned_until = now() + interval '876000 hours' where id = auth.uid();
    -- After an Unban they start from nothing, not one burst away from the next ban.
    update public.click_rate r set clicks = 0, window_start = now(), paused_until = null, pause_streak = 0
    where r.user_id = auth.uid();
    insert into public.click_history (user_id, feature, kind, streak)
    values (auth.uid(), count_click.feature, 'ban', streak);
  else
    if lim.daily_reset_time_zone is not null then
      -- A daily limit pauses until the next midnight in its time zone.
      next_midnight := ((now() at time zone lim.daily_reset_time_zone)::date + 1)::timestamp at time zone lim.daily_reset_time_zone;
      minutes := ceil(extract(epoch from next_midnight - now()) / 60)::int;
    else
      minutes := case when streak > 1 then lim.repeat_pause_minutes else lim.first_pause_minutes end;
      next_midnight := null;
    end if;
    update public.click_rate r set
      clicks = 0,
      window_start = now(),
      pause_streak = streak,
      paused_until = coalesce(next_midnight, now() + make_interval(mins => minutes))
    where r.user_id = auth.uid() and r.feature = count_click.feature;
    insert into public.click_history (user_id, feature, kind, pause_minutes, streak)
    values (auth.uid(), count_click.feature, 'pause', minutes, streak);
  end if;
end;
$$;

-- set_display_name: same as before (20261113000000_display_name_rules.sql); only is_super_admin() is new.
-- Keep 30 days the same as DISPLAY_NAME_CHANGE_DAYS in userSettings.ts.
create or replace function public.set_display_name(name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_name text := trim(coalesce(name, ''));
  current_name text;
  changed_at timestamptz;
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;

  perform public.count_click('display_name');

  select s.display_name, s.display_name_changed_at into current_name, changed_at
  from public.user_settings s
  where s.user_id = me;

  -- Nothing to change: no wait starts.
  if new_name = coalesce(current_name, '') then
    return jsonb_build_object('status', 'saved');
  end if;

  if not public.is_super_admin() and changed_at > now() - interval '30 days' then
    return jsonb_build_object(
      'status', 'wait',
      'until', (extract(epoch from changed_at + interval '30 days') * 1000)::bigint
    );
  end if;

  if new_name <> '' and not public.claim_display_name(public.profile_slug(new_name), me) then
    return jsonb_build_object('status', 'taken');
  end if;

  -- Lets the guard below through, for this transaction only.
  perform set_config('qm.set_display_name', 'on', true);
  begin
    insert into public.user_settings as s (user_id, display_name, display_name_changed_at, updated_at)
    values (me, new_name, now(), now())
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      display_name_changed_at = excluded.display_name_changed_at,
      updated_at = excluded.updated_at;
  exception when unique_violation then
    -- Someone took it at the same moment.
    return jsonb_build_object('status', 'taken');
  end;

  return jsonb_build_object('status', 'saved');
end;
$$;
