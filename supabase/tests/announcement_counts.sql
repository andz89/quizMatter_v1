-- Announcement counts kept on the row, and the cleanup of old "closed" rows
-- (supabase/migrations/20261223000000_announcement_counts.sql; saving without counting and the cleanup in batches:
-- 20261224000000_announcement_fast_counts.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_counts.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): s1 super admin, p1 plain admin, t1 and t2 teachers ─────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d1', 'count-super@example.com', '{"first_name": "Count", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000d2', 'count-admin@example.com', '{"first_name": "Count", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000d3', 'count-t1@example.com', '{"first_name": "Count", "last_name": "One"}'),
  ('00000000-0000-4000-8000-0000000000d4', 'count-t2@example.com', '{"first_name": "Count", "last_name": "Two"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000000d1', true),
  ('00000000-0000-4000-8000-0000000000d2', false);

-- Every account that can match (not banned), so the matched count can be checked.
create temp table accounts_now as
  select count(*)::int as n from public.user_settings s
  where not exists (select 1 from public.banned_users b where b.user_id = s.user_id);

create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select '{
    "name": "Count test", "is_on": true, "starts_at": null, "ends_at": null,
    "show_modal": true, "modal_text": "Hello", "modal_close_after": 0,
    "show_bar": true, "bar_html": "<p>Bar</p>", "bar_close_after": 0,
    "repeat": "once", "pages": ["all"], "modal_size": "large",
    "genders": [], "age_min": null, "age_max": null, "provinces": [], "town_words": [],
    "education_levels": [], "field_words": [], "presentations_min": null, "presentations_max": null, "roles": []
  }'::jsonb || extra;
$$;

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  select set_config('quizmatter.admin_logged', '', true);
$$;

create function pg_temp.row_of(target uuid) returns record language plpgsql as $$
declare
  r record;
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000000d1');
  select a.matched, a.closed_modal, a.closed_bar, a.counted_at into r from public.admin_announcements() a where a.id = target;
  return r;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, service_role;
grant select on accounts_now to authenticated;
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
set local role authenticated;

-- ─── 1. A save doesn't count; "Count again" does; closing doesn't change the numbers until the next count ───
do $$
declare
  s1 constant uuid := '00000000-0000-4000-8000-0000000000d1';
  t1 constant uuid := '00000000-0000-4000-8000-0000000000d3';
  t2 constant uuid := '00000000-0000-4000-8000-0000000000d4';
  live_id uuid;
  matched int;
  closed_modal int;
  closed_bar int;
  counted_at timestamptz;
begin
  perform pg_temp.act_as(s1);
  live_id := public.save_announcement(pg_temp.ann('{}'));
  insert into ids values ('live', live_id);

  select r.matched, r.counted_at into matched, counted_at
  from pg_temp.row_of(live_id) as r(matched int, closed_modal int, closed_bar int, counted_at timestamptz);
  if matched is not null or counted_at is not null then
    raise exception 'FAIL: the save counted (matched %, counted at %); the app counts in a separate step', matched, counted_at;
  end if;

  perform pg_temp.act_as(s1);
  perform public.recount_announcement(live_id);
  select r.matched, r.closed_modal, r.closed_bar, r.counted_at into matched, closed_modal, closed_bar, counted_at
  from pg_temp.row_of(live_id) as r(matched int, closed_modal int, closed_bar int, counted_at timestamptz);
  if matched is distinct from (select n from accounts_now) or closed_modal <> 0 or counted_at is null then
    raise exception 'FAIL: after Count again: matched %, closed %, counted at %', matched, closed_modal, counted_at;
  end if;

  perform pg_temp.act_as(t1);
  perform public.dismiss_announcement(live_id, 'modal');
  perform pg_temp.act_as(t2);
  perform public.dismiss_announcement(live_id, 'modal');
  perform public.dismiss_announcement(live_id, 'bar');

  select r.closed_modal into closed_modal
  from pg_temp.row_of(live_id) as r(matched int, closed_modal int, closed_bar int, counted_at timestamptz);
  if closed_modal <> 0 then
    raise exception 'FAIL: the list counted closes by itself (closed modal %)', closed_modal;
  end if;

  perform pg_temp.act_as(s1);
  perform public.recount_announcement(live_id);
  select r.closed_modal, r.closed_bar into closed_modal, closed_bar
  from pg_temp.row_of(live_id) as r(matched int, closed_modal int, closed_bar int, counted_at timestamptz);
  if closed_modal <> 2 or closed_bar <> 1 then
    raise exception 'FAIL: after Count again: closed modal %, bar % (want 2, 1)', closed_modal, closed_bar;
  end if;
end;
$$;

-- ─── 2. Only the super admin can count again; teachers can't run the cleanup ─────────────────────────────────
do $$
declare
  live_id uuid := (select id from ids where name = 'live');
  who uuid;
  was_refused boolean;
begin
  foreach who in array array['00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3']::uuid[] loop
    perform pg_temp.act_as(who);
    was_refused := false;
    begin
      perform public.recount_announcement(live_id);
    exception when others then
      was_refused := true;
    end;
    if not was_refused then
      raise exception 'FAIL: % could count again', who;
    end if;
  end loop;

  was_refused := false;
  begin
    perform public.cleanup_announcement_dismissals(50000);
  exception when others then
    was_refused := true;
  end;
  if not was_refused then
    raise exception 'FAIL: a teacher could run the cleanup';
  end if;
end;
$$;

-- ─── 3. Closing one that isn't live writes nothing ───────────────────────────────────────────────────────────
do $$
declare
  ended_id uuid;
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000000d1');
  ended_id := public.save_announcement(pg_temp.ann('{"name": "Ended"}') || jsonb_build_object('ends_at', now() - interval '1 hour'));
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000000d3');
  perform public.dismiss_announcement(ended_id, 'modal');
  reset role;
  if exists (select 1 from public.announcement_dismissals where announcement_id = ended_id) then
    raise exception 'FAIL: closing an ended announcement wrote a row';
  end if;
  set local role authenticated;
end;
$$;

-- ─── 4. The cleanup, in batches: ended over 30 days ago → counts kept, rows deleted; ended 10 days ago → kept ─
reset role;
do $$
declare
  live_id uuid := (select id from ids where name = 'live');
  recent_id uuid := gen_random_uuid();
begin
  -- A second announcement that ended 10 days ago, with one close (written straight in, as postgres).
  insert into public.announcements (id, name, is_on, ends_at, show_modal, modal_text, created_by)
  values (recent_id, 'Recent', true, now() - interval '10 days', true, 'Hi',
    '00000000-0000-4000-8000-0000000000d1');
  insert into public.announcement_dismissals (announcement_id, user_id, part)
  values (recent_id, '00000000-0000-4000-8000-0000000000d3', 'modal');
  insert into ids values ('recent', recent_id);
  -- The first one ended 31 days ago.
  update public.announcements set ends_at = now() - interval '31 days' where id = live_id;
end;
$$;

-- Batches of 1 row: 3 rows take 3 rounds, and the 4th deletes nothing. The counts are kept from the first round.
create temp table rounds (round int, deleted int);
grant all on rounds to service_role;
set local role service_role;
insert into rounds select 1, public.cleanup_announcement_dismissals(1);
insert into rounds select 2, public.cleanup_announcement_dismissals(1);
insert into rounds select 3, public.cleanup_announcement_dismissals(1);
insert into rounds select 4, public.cleanup_announcement_dismissals(1);
reset role;

do $$
begin
  if (select array_agg(deleted order by round) from rounds) <> array[1, 1, 1, 0] then
    raise exception 'FAIL: the cleanup rounds deleted % (want 1, 1, 1, 0)', (select array_agg(deleted order by round) from rounds);
  end if;
end;
$$;

do $$
declare
  live_id uuid := (select id from ids where name = 'live');
  recent_id uuid := (select id from ids where name = 'recent');
  a record;
begin
  if exists (select 1 from public.announcement_dismissals where announcement_id = live_id) then
    raise exception 'FAIL: the cleanup left the rows of an announcement that ended 31 days ago';
  end if;
  select * into a from public.announcements where id = live_id;
  if a.closed_modal_count <> 2 or a.closed_bar_count <> 1 or a.closed_cleared_at is null then
    raise exception 'FAIL: the cleanup lost the counts: modal %, bar %, cleared %',
      a.closed_modal_count, a.closed_bar_count, a.closed_cleared_at;
  end if;
  if not exists (select 1 from public.announcement_dismissals where announcement_id = recent_id) then
    raise exception 'FAIL: the cleanup deleted the rows of one that ended 10 days ago';
  end if;
end;
$$;

-- ─── 5. Count again after the cleanup keeps the closed numbers ───────────────────────────────────────────────
set local role authenticated;
do $$
declare
  live_id uuid := (select id from ids where name = 'live');
  closed_modal int;
  closed_bar int;
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000000d1');
  perform public.recount_announcement(live_id);
  select r.closed_modal, r.closed_bar into closed_modal, closed_bar
  from pg_temp.row_of(live_id) as r(matched int, closed_modal int, closed_bar int, counted_at timestamptz);
  if closed_modal <> 2 or closed_bar <> 1 then
    raise exception 'FAIL: Count again after the cleanup gave closed modal %, bar % (want 2, 1)', closed_modal, closed_bar;
  end if;
end;
$$;

rollback;
