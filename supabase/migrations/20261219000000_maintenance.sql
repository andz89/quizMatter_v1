-- Maintenance mode: the super admin stops everyone else (teachers, editors, plain admins) while fixing things.
-- Admin → Maintenance turns it on and off, and can announce it ahead (a yellow bar on every page). Notes: the root
-- CLAUDE.md, "Maintenance".
-- - maintenance: one row. is_on, the note teachers read (message), when and by whom it started, and the announced
--   time (planned_at). Nobody reads or changes it through the API: maintenance_status() reads it for everyone, and
--   set_maintenance / announce_maintenance change it.
-- - The guard: while maintenance is on, PostgREST (Supabase's API) runs check_maintenance() before every request
--   (its db_pre_request setting), and it refuses everyone but the super admin with QMMNT (HTTP 503). set_maintenance
--   adds the setting when it turns maintenance on and removes it when it turns it off, so on normal days nothing
--   extra runs. If the guard ever gets stuck, run as postgres:
--     alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
-- - hook_before_user_created (newest before this: 20261210000400_blocked_email_domains.sql) refuses sign ups while
--   maintenance is on (Supabase's login service doesn't go through PostgREST).
-- - The Admin log gets maintenance_on, maintenance_off and maintenance_announced (target_type 'site').
-- Test: supabase/tests/maintenance.sql.

-- ─── 1. The one row ───────────────────────────────────────────────────────────────────────────────────────────
create table public.maintenance (
  -- Always true, so the table can hold only one row.
  id boolean primary key default true check (id),
  is_on boolean not null default false,
  -- Shown on the maintenance page and in the announcement bar ('' = the page's own words only). Same limit as
  -- MAINTENANCE_MESSAGE_MAX in src/lib/maintenance.ts.
  message text not null default '' check (char_length(message) <= 300),
  started_at timestamptz,
  started_by uuid references auth.users (id) on delete set null,
  -- When maintenance is announced to start (the bar shows until then). Cleared when it starts.
  planned_at timestamptz
);

insert into public.maintenance default values;

-- No policies: maintenance_status() and the functions below read and change it.
alter table public.maintenance enable row level security;
revoke all on public.maintenance from anon, authenticated, public;

-- ─── 2. Reading it (anyone, also logged out: the proxy and the maintenance page) ──────────────────────────────
-- An announced time only while it's still ahead.
create function public.maintenance_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_on', m.is_on,
    'message', m.message,
    'started_at', m.started_at,
    'planned_at', case when not m.is_on and m.planned_at > now() then m.planned_at end
  )
  from public.maintenance m;
$$;

revoke execute on function public.maintenance_status() from public;
grant execute on function public.maintenance_status() to anon, authenticated, service_role, supabase_auth_admin;

-- ─── 3. The guard PostgREST runs before every request while maintenance is on ─────────────────────────────────
-- Security invoker, so current_user is the request's role (anon, authenticated or service_role). Lets through the
-- secret-key server client (the cleanups check maintenance themselves), the maintenance_status call, and the super
-- admin. A double check: if the row says off (the setting was somehow left behind), everyone gets through.
create function public.check_maintenance()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role'
    or current_setting('request.path', true) = '/rpc/maintenance_status'
    or not (select m.is_on from public.maintenance m where m.id)
  then
    return;
  end if;
  -- Its own step: Postgres checks the right to call is_super_admin() even when an "or" wouldn't need it, and anon
  -- has none.
  if current_user = 'authenticated' then
    if public.is_super_admin() then
      return;
    end if;
  end if;
  -- PostgREST turns this into the answer: HTTP 503 with {"code": "QMMNT", ...} (REFUSALS in
  -- src/lib/presentations.ts, and src/components/MaintenanceWatch.tsx sends the tab to /maintenance).
  raise sqlstate 'PGRST' using
    message = '{"code": "QMMNT", "message": "QuizMatter is under maintenance. Please try again later."}',
    detail = '{"status": 503, "headers": {"Retry-After": "600"}}';
end;
$$;

-- check_maintenance reads the row as the request's role, so it needs its own read rule (only the on/off column).
grant select (id, is_on) on public.maintenance to anon, authenticated, service_role;
create policy "The maintenance guard reads the row" on public.maintenance
  for select to anon, authenticated, service_role using (true);

revoke execute on function public.check_maintenance() from public;
grant execute on function public.check_maintenance() to anon, authenticated, service_role;

-- ─── 4. The Admin log's new actions ───────────────────────────────────────────────────────────────────────────
-- Same list as 20261214000000_profile_photos.sql, plus the three maintenance ones. Same keys as
-- ADMIN_ACTION_LABELS in src/lib/adminActions.ts.
alter table public.admin_actions
  drop constraint admin_actions_action_check,
  add constraint admin_actions_action_check check (action in (
    'review_published', 'review_sent_back', 'review_canceled', 'review_opened', 'review_closed',
    'submission_approved', 'submission_sent_back',
    'presentation_shared', 'presentation_unshared', 'presentation_moved', 'presentation_hidden',
    'presentation_unhidden', 'reports_dismissed', 'presentation_deleted',
    'teacher_banned', 'ban_updated', 'teacher_unbanned', 'editor_added', 'editor_removed', 'pause_released',
    'category_created', 'category_renamed', 'category_deleted',
    'photo_deleted',
    'profile_photo_removed',
    'maintenance_on', 'maintenance_off', 'maintenance_announced'
  )),
  drop constraint admin_actions_target_type_check,
  add constraint admin_actions_target_type_check check (target_type in ('presentation', 'user', 'category', 'photo', 'site'));

-- ─── 5. Turning it on and off (super admin only) ──────────────────────────────────────────────────────────────
-- On: saves the note, clears the announcement, and adds the guard. Off: removes the guard (the note stays for next
-- time). PostgREST reloads its settings on the notify, which arrives when this commits (within about a second).
create function public.set_maintenance(turn_on boolean, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  if turn_on then
    update public.maintenance
    set is_on = true, message = btrim(coalesce(note, '')), started_at = now(), started_by = auth.uid(), planned_at = null
    where id;
    alter role authenticator set pgrst.db_pre_request = 'public.check_maintenance';
  else
    update public.maintenance set is_on = false, started_at = null, started_by = null where id;
    alter role authenticator reset pgrst.db_pre_request;
  end if;
  notify pgrst, 'reload config';

  perform public.log_admin_action(
    case when turn_on then 'maintenance_on' else 'maintenance_off' end, 'site', null, 'QuizMatter', null
  );
end;
$$;

revoke execute on function public.set_maintenance(boolean, text) from public, anon;
grant execute on function public.set_maintenance(boolean, text) to authenticated;

-- Announces when maintenance will start, with the note (null = take the announcement away). Only while it's off.
create function public.announce_maintenance(planned timestamptz, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if (select m.is_on from public.maintenance m where m.id) then
    raise exception 'Maintenance is already on.' using errcode = '22023';
  end if;
  if planned is not null and planned <= now() then
    raise exception 'Pick a time in the future.' using errcode = '22023';
  end if;

  update public.maintenance
  set planned_at = planned, message = case when planned is null then message else btrim(coalesce(note, '')) end
  where id;

  if planned is not null then
    perform public.log_admin_action(
      'maintenance_announced', 'site', null, 'QuizMatter', jsonb_build_object('planned_at', planned)
    );
  end if;
end;
$$;

revoke execute on function public.announce_maintenance(timestamptz, text) from public, anon;
grant execute on function public.announce_maintenance(timestamptz, text) to authenticated;

-- ─── 6. No sign ups during maintenance ────────────────────────────────────────────────────────────────────────
-- Same as 20261210000400_blocked_email_domains.sql, plus the maintenance check first.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  client_ip inet;
  -- What comes after the last "@", in small letters (like the sign up page). No email (e.g. a phone sign up): ''.
  email_domain text := lower(split_part(coalesce(event -> 'user' ->> 'email', ''), '@', -1));
begin
  if (public.maintenance_status() ->> 'is_on')::boolean then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 503,
      'message', 'QuizMatter is under maintenance. Please try again later.'
    ));
  end if;

  -- A throwaway email service: refused, whatever the internet address. Same words as THROWAWAY_EMAIL_MESSAGE in
  -- src/lib/userSettings.ts, so the sign up page shows them.
  if exists (select 1 from public.blocked_email_domains b where b.domain = email_domain) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Please use your real email address (school or personal), not a throwaway one.'
    ));
  end if;

  -- No address, or one Postgres can't read (shouldn't happen): allow, rather than block everyone.
  begin
    client_ip := nullif(event -> 'metadata' ->> 'ip_address', '')::inet;
  exception when others then
    client_ip := null;
  end;
  if client_ip is null then
    return '{}'::jsonb;
  end if;

  if (
    select count(*) from public.sign_up_attempts a
    where a.ip = client_ip and a.created_at > now() - interval '1 hour'
  ) >= 10 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'Too many accounts were made from this internet connection. Please try again in an hour.'
    ));
  end if;

  insert into public.sign_up_attempts (ip) values (client_ip);
  return '{}'::jsonb;
end;
$$;
