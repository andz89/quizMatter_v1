-- Admin → Admin log: a row for every step an admin takes (publish a review, hide a presentation, ban a teacher, …).
-- Design: docs/superpowers/specs/2026-10-23-admin-overview-design.md (section 3).
--
-- The rows are written here, in the database, by triggers on the tables the admin's step changes (so the existing
-- functions don't change), and by three small rpcs the app calls after a ban, an unban or a pause release worked.
-- Only an admin's steps are logged (is_admin() is false with the secret key and in before_account_delete).
--
-- One click = one row. A step's side effects (a deleted presentation's reports and shared copy, the copies removed
-- when someone becomes an editor, the reviews canceled when the editor role is taken away) aren't logged: the first
-- trigger that logs sets the flag quizmatter.admin_logged for the rest of the transaction, and every other logging
-- trigger skips while it is set. The logging triggers are "before" triggers, so they run before the side effects.
--
-- The trigger functions are security definer: they call log_admin_action, which nobody else may run.

-- ─── 1. The log ───────────────────────────────────────────────────────────────────────────────────────────────
-- Same keys as ADMIN_ACTION_LABELS in src/lib/adminActions.ts.
create table public.admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  -- Saved at the time, so the row stays readable after the account (or the presentation) is gone.
  admin_name text not null default '',
  action text not null check (action in (
    'review_published', 'review_sent_back', 'review_canceled', 'review_opened', 'review_closed',
    'submission_approved', 'submission_sent_back',
    'presentation_shared', 'presentation_unshared', 'presentation_moved', 'presentation_hidden',
    'presentation_unhidden', 'reports_dismissed', 'presentation_deleted',
    'teacher_banned', 'ban_updated', 'teacher_unbanned', 'editor_added', 'editor_removed', 'pause_released',
    'category_created', 'category_renamed', 'category_deleted',
    'photo_deleted'
  )),
  target_type text not null check (target_type in ('presentation', 'user', 'category', 'photo')),
  target_id text,
  target_title text not null default '',
  details jsonb,
  created_at timestamptz not null default now()
);

create index admin_actions_created_at on public.admin_actions (created_at desc);
create index admin_actions_admin_created_at on public.admin_actions (admin_id, created_at desc);

-- Only the super admin reads it. No insert / update / delete policies: nobody can change the rows.
alter table public.admin_actions enable row level security;

-- Signed-in users may only read (and RLS still limits that to the super admin); anon gets nothing.
revoke all on public.admin_actions from anon, authenticated;
grant select on public.admin_actions to authenticated;

create policy "Super admin reads the admin log" on public.admin_actions
  for select to authenticated using (public.is_super_admin());

-- ─── 2. Writing a row ─────────────────────────────────────────────────────────────────────────────────────────
-- The calling admin's name, the same way submit_review / approve_submission build one: their display name, or the
-- part of their email before "@".
create function public.admin_log_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1), '')
  from auth.users u
  left join public.user_settings st on st.user_id = u.id
  where u.id = (select auth.uid());
$$;

revoke execute on function public.admin_log_name() from public, anon, authenticated;

-- Writes one row, unless this step is already logged (the flag) or the caller isn't an admin. Then sets the flag.
create function public.log_admin_action(
  action text, target_type text, target_id text, target_title text, details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('quizmatter.admin_logged', true), '') = 'yes' or not public.is_admin() then
    return;
  end if;
  insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_title, details)
  values (
    auth.uid(), coalesce(public.admin_log_name(), ''), log_admin_action.action, log_admin_action.target_type,
    log_admin_action.target_id, coalesce(log_admin_action.target_title, ''), log_admin_action.details
  );
  perform set_config('quizmatter.admin_logged', 'yes', true);
end;
$$;

revoke execute on function public.log_admin_action(text, text, text, text, jsonb) from public, anon, authenticated;

-- ─── 3. Reviews: publish, send back, cancel, open / close to all editors ─────────────────────────────────────
-- One function for two triggers: "before update" (publish_review, send_back_review, admin_cancel_review, and
-- set_review_open on a presentation that already has a row) and "after insert" (set_review_open on one that has
-- none yet: it inserts the row). The insert one is "after" because set_review_open's "on conflict do update" runs
-- "before insert" triggers even when the row exists and only the update happens; an insert has no side effects.
create function public.log_review_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  title text := (select p.title from public.presentations p where p.id = new.presentation_id);
begin
  if tg_op = 'INSERT' then
    -- A new row starts closed (open_to_all defaults to false), so only opening it is a change.
    if new.open_to_all then
      perform public.log_admin_action('review_opened', 'presentation', new.presentation_id, title, null);
    end if;
  elsif old.status = 'submitted' and new.status = 'published' then
    perform public.log_admin_action('review_published', 'presentation', new.presentation_id, title, null);
  elsif old.status = 'submitted' and new.status = 'reviewing' then
    perform public.log_admin_action(
      'review_sent_back', 'presentation', new.presentation_id, title, jsonb_build_object('note', new.admin_note)
    );
  elsif new.status = 'canceled' and old.status is distinct from 'canceled' then
    -- A reviewer's own Stop review isn't logged: log_admin_action only logs admins.
    perform public.log_admin_action('review_canceled', 'presentation', new.presentation_id, title, null);
  elsif new.open_to_all is distinct from old.open_to_all then
    perform public.log_admin_action(
      case when new.open_to_all then 'review_opened' else 'review_closed' end,
      'presentation', new.presentation_id, title, null
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.log_review_change() from public, anon, authenticated;

create trigger log_review_change
  before update on public.presentation_reviews
  for each row execute function public.log_review_change();

create trigger log_review_insert
  after insert on public.presentation_reviews
  for each row execute function public.log_review_change();

-- ─── 4. Submissions: approve, send back ───────────────────────────────────────────────────────────────────────
-- An approved one points at the new QuizMatter copy (it stays after the editor deletes their original).
create function public.log_submission_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  title text;
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'sent_back') then
    return new;
  end if;
  title := coalesce(
    nullif(new.title, ''), (select p.title from public.presentations p where p.id = new.presentation_id)
  );
  if new.status = 'approved' then
    perform public.log_admin_action(
      'submission_approved', 'presentation', coalesce(new.copy_id, new.presentation_id), title, null
    );
  else
    perform public.log_admin_action(
      'submission_sent_back', 'presentation', new.presentation_id, title, jsonb_build_object('note', new.admin_note)
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.log_submission_change() from public, anon, authenticated;

create trigger log_submission_change
  before update on public.presentation_submissions
  for each row execute function public.log_submission_change();

-- ─── 5. Presentations: share / unshare, move to QuizMatter, hide / unhide, delete ─────────────────────────────
-- Move to QuizMatter also turns is_published off in the same update: it's logged as the move only.
create function public.log_presentation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.from_admin and not old.from_admin then
    perform public.log_admin_action('presentation_moved', 'presentation', new.id, new.title, null);
  elsif new.from_admin and new.is_published is distinct from old.is_published then
    perform public.log_admin_action(
      case when new.is_published then 'presentation_shared' else 'presentation_unshared' end,
      'presentation', new.id, new.title, null
    );
  elsif (new.hidden_at is null) <> (old.hidden_at is null) then
    perform public.log_admin_action(
      case when new.hidden_at is null then 'presentation_unhidden' else 'presentation_hidden' end,
      'presentation', new.id, new.title, null
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.log_presentation_change() from public, anon, authenticated;

create trigger log_presentation_change
  before update on public.presentations
  for each row execute function public.log_presentation_change();

-- An admin deleting a QuizMatter presentation or someone else's. Their own non-QuizMatter one is a normal teacher
-- step. Delete can remove several at once (the home page's multi-select), and each is its own step, so this one
-- doesn't skip on the flag: it skips rows removed by another trigger or a cascade instead (pg_trigger_depth() > 1,
-- e.g. a shared copy going with its original, or the copies removed when someone becomes an editor). It still sets
-- the flag, so the reports that go with it aren't logged as dismissed.
create function public.log_presentation_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 or not public.is_admin() or not (old.from_admin or old.owner_id <> auth.uid()) then
    return old;
  end if;
  perform set_config('quizmatter.admin_logged', '', true);
  perform public.log_admin_action('presentation_deleted', 'presentation', old.id, old.title, null);
  return old;
end;
$$;

revoke execute on function public.log_presentation_delete() from public, anon, authenticated;

create trigger log_presentation_delete
  before delete on public.presentations
  for each row execute function public.log_presentation_delete();

-- ─── 6. Reports dismissed ─────────────────────────────────────────────────────────────────────────────────────
-- Once per presentation, not per report: a statement trigger that sees every deleted report at once. Reports that
-- went with a deleted presentation aren't dismissed: skipped by the flag, and their presentation is gone anyway.
create function public.log_reports_dismissed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('quizmatter.admin_logged', true), '') = 'yes' or not public.is_admin() then
    return null;
  end if;
  insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_title, details)
  select auth.uid(), coalesce(public.admin_log_name(), ''), 'reports_dismissed', 'presentation', p.id, p.title,
         jsonb_build_object('count', r.total)
  from (select o.presentation_id, count(*) as total from old_reports o group by o.presentation_id) r
  join public.presentations p on p.id = r.presentation_id;
  if found then
    perform set_config('quizmatter.admin_logged', 'yes', true);
  end if;
  return null;
end;
$$;

revoke execute on function public.log_reports_dismissed() from public, anon, authenticated;

create trigger log_reports_dismissed
  after delete on public.presentation_reports
  referencing old table as old_reports
  for each statement execute function public.log_reports_dismissed();

-- ─── 7. The editor role: give / take ──────────────────────────────────────────────────────────────────────────
-- Before the copies removed by remove_new_editor_copies and the reviews canceled by
-- cancel_reviews_of_removed_editor (both "after" triggers), so those aren't logged. setEditor gives the role with
-- an upsert, which runs this even for someone who is already an editor: that isn't logged.
create function public.log_editor_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := case when tg_op = 'INSERT' then new.user_id else old.user_id end;
  email text := (select u.email from auth.users u where u.id = who);
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.editors e where e.user_id = new.user_id) then
      perform public.log_admin_action('editor_added', 'user', who::text, email, null);
    end if;
    return new;
  end if;
  perform public.log_admin_action('editor_removed', 'user', who::text, email, null);
  return old;
end;
$$;

revoke execute on function public.log_editor_change() from public, anon, authenticated;

create trigger log_editor_change
  before insert or delete on public.editors
  for each row execute function public.log_editor_change();

-- ─── 8. Photo categories and shared photos ────────────────────────────────────────────────────────────────────
create function public.log_category_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_admin_action('category_created', 'category', new.id::text, new.name, null);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      perform public.log_admin_action(
        'category_renamed', 'category', new.id::text, new.name, jsonb_build_object('old_name', old.name)
      );
    end if;
    return new;
  end if;
  perform public.log_admin_action('category_deleted', 'category', old.id::text, old.name, null);
  return old;
end;
$$;

revoke execute on function public.log_category_change() from public, anon, authenticated;

create trigger log_category_change
  before insert or update of name or delete on public.photo_categories
  for each row execute function public.log_category_change();

create function public.log_shared_photo_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.log_admin_action('photo_deleted', 'photo', old.src, old.file_name, null);
  return old;
end;
$$;

revoke execute on function public.log_shared_photo_delete() from public, anon, authenticated;

create trigger log_shared_photo_delete
  before delete on public.shared_photos
  for each row execute function public.log_shared_photo_delete();

-- ─── 9. Bans and pause releases (the app calls these after the step fully worked) ─────────────────────────────
-- banTeacher / unbanTeacher also change Supabase's login ban, which the database can't see, so the app calls these
-- once both parts worked. The database still checks the fact itself. Automatic bans (click limits) aren't logged.

-- A ban: needs the banned_users row (the reason comes from it). Banning someone already banned (the latest of
-- their ban rows here isn't an unban) is "Changed a ban reason".
create function public.log_ban(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ban_reason text;
  last_action text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  select b.reason into ban_reason from public.banned_users b where b.user_id = target;
  if not found then
    raise exception 'This teacher isn''t banned.' using errcode = 'P0002';
  end if;
  select a.action into last_action
  from public.admin_actions a
  where a.target_id = target::text and a.action in ('teacher_banned', 'ban_updated', 'teacher_unbanned')
  order by a.created_at desc, a.id desc
  limit 1;
  perform public.log_admin_action(
    case when last_action is not null and last_action <> 'teacher_unbanned' then 'ban_updated' else 'teacher_banned' end,
    'user', target::text, (select u.email from auth.users u where u.id = target),
    jsonb_build_object('reason', ban_reason)
  );
end;
$$;

revoke execute on function public.log_ban(uuid) from public, anon;
grant execute on function public.log_ban(uuid) to authenticated;

-- An unban: needs the banned_users row to be gone.
create function public.log_unban(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = target) then
    raise exception 'This teacher is still banned.' using errcode = '22023';
  end if;
  perform public.log_admin_action(
    'teacher_unbanned', 'user', target::text, (select u.email from auth.users u where u.id = target), null
  );
end;
$$;

revoke execute on function public.log_unban(uuid) from public, anon;
grant execute on function public.log_unban(uuid) to authenticated;

-- A click pause released (releasePause uses the secret key, so its own change can't be logged by a trigger).
create function public.log_click_release(target uuid, feature text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.click_limits c where c.feature = log_click_release.feature) then
    raise exception 'Unknown feature.' using errcode = '22023';
  end if;
  perform public.log_admin_action(
    'pause_released', 'user', target::text, (select u.email from auth.users u where u.id = target),
    jsonb_build_object('feature', log_click_release.feature)
  );
end;
$$;

revoke execute on function public.log_click_release(uuid, text) from public, anon;
grant execute on function public.log_click_release(uuid, text) to authenticated;
