-- Announcements (supabase/migrations/20261221000000_announcements.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcements.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- a1 super admin, a2 plain admin, t1 teacher with every detail, t2 teacher with every detail empty, e1 editor,
-- b1 banned teacher (same details as t1, so only the ban keeps them out).
-- Accounts that were there before the test (none on a fresh reset), so the counts below still add up.
create temp table before_test as
  select
    (select count(*) from public.user_settings s
      where not exists (select 1 from public.banned_users b where b.user_id = s.user_id))::int as accounts,
    (select count(*) from public.user_settings s where s.gender = 'female'
      and not exists (select 1 from public.banned_users b where b.user_id = s.user_id))::int as females;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f1', 'ann-super@example.com', '{"first_name": "Ann", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'ann-admin@example.com', '{"first_name": "Ann", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'ann-t1@example.com', '{"first_name": "Ann", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000f4', 'ann-t2@example.com', '{"first_name": "Ann", "last_name": "Empty"}'),
  ('00000000-0000-4000-8000-0000000000f5', 'ann-e1@example.com', '{"first_name": "Ann", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000f6', 'ann-b1@example.com', '{"first_name": "Ann", "last_name": "Banned"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000000f1', true),
  ('00000000-0000-4000-8000-0000000000f2', false);
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000f5');
insert into public.banned_users (user_id, reason) values ('00000000-0000-4000-8000-0000000000f6', 'Test ban');

-- t1 is 36 today, whatever day the test runs (born 36½ years ago), so the age checks don't go stale.
update public.user_settings set
  birth_date = (public.manila_today() - interval '36 years 6 months')::date,
  gender = 'female', province = 'Cebu', town = 'Mandaue City',
  education_level = 'master', education_field = 'Secondary Education, major in English'
where user_id in ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f6');
update public.user_settings set birth_date = null, gender = '', province = '', town = '', education_level = '',
  education_field = ''
where user_id = '00000000-0000-4000-8000-0000000000f4';

-- t1: 3 own presentations and 1 shared copy (not counted).
insert into public.presentations (id, owner_id, title) values
  ('test-ann-p1', '00000000-0000-4000-8000-0000000000f3', 'One'),
  ('test-ann-p2', '00000000-0000-4000-8000-0000000000f3', 'Two'),
  ('test-ann-p3', '00000000-0000-4000-8000-0000000000f3', 'Three');
select set_config('quizmatter.sharing', 'yes', true);
insert into public.presentations (id, owner_id, title, shared_from, shared_at) values
  ('test-ann-c1', '00000000-0000-4000-8000-0000000000f3', 'One', 'test-ann-p1', now());
select set_config('quizmatter.sharing', '', true);

-- An announcement with every key: modal only, once, all pages, no filters. `extra` replaces some keys.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select '{
    "name": "Test", "is_on": true, "starts_at": null, "ends_at": null,
    "show_modal": true, "modal_text": "Hello", "modal_close_after": 0,
    "show_bar": false, "bar_html": "", "bar_close_after": 0,
    "repeat": "once", "pages": ["all"],
    "genders": [], "age_min": null, "age_max": null, "provinces": [], "town_words": [],
    "education_levels": [], "field_words": [], "presentations_min": null, "presentations_max": null, "roles": []
  }'::jsonb || extra;
$$;

-- Tries a step as a user; true when it was refused (any error).
create function pg_temp.refused(who uuid, step text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  -- The Admin log writes one row per transaction (log_admin_action's flag); in the app each step is its own.
  perform set_config('quizmatter.admin_logged', '', true);
  execute step;
  return false;
exception when others then
  return true;
end;
$$;

-- Saves as the super admin; returns the id.
create function pg_temp.save(a jsonb) returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);
  perform set_config('quizmatter.admin_logged', '', true);
  return public.save_announcement(a);
end;
$$;

-- How many my_announcements rows a user gets for this announcement (0 or 1).
create function pg_temp.mine(who uuid, target uuid) returns int language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  return (select count(*) from public.my_announcements() m where m.id = target);
end;
$$;

-- The announcements key, as anyone.
create function pg_temp.key() returns text language sql as $$
  select public.maintenance_status() ->> 'announcements_key';
$$;

grant execute on all functions in schema pg_temp to authenticated, service_role;
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
grant select on before_test to authenticated;

-- ─── 1. Teachers and plain admins are refused ─────────────────────────────────────────────────────────────────
set local role authenticated;
do $$
declare
  who uuid;
  step text;
begin
  foreach who in array array['00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f2']::uuid[] loop
    foreach step in array array[
      'select public.save_announcement(pg_temp.ann(''{}''))',
      'select public.set_announcement_on(gen_random_uuid(), true)',
      'select public.delete_announcement(gen_random_uuid())',
      'select * from public.admin_announcements()',
      'select public.announcement_audience(''{}'')'
    ] loop
      if not pg_temp.refused(who, step) then
        raise exception 'FAIL: % was allowed: %', who, step;
      end if;
    end loop;
  end loop;
  if not pg_temp.refused('00000000-0000-4000-8000-0000000000f3', 'select * from public.announcements') then
    raise exception 'FAIL: a teacher read announcements directly';
  end if;
  if not pg_temp.refused('00000000-0000-4000-8000-0000000000f3', 'select * from public.announcement_dismissals') then
    raise exception 'FAIL: a teacher read announcement_dismissals directly';
  end if;
end;
$$;

-- ─── 2. An announcement with no filters reaches everyone but the banned teacher ───────────────────────────────
do $$
declare
  a uuid;
begin
  if pg_temp.key() is not null then
    raise exception 'FAIL: announcements_key is set while nothing is live';
  end if;
  a := pg_temp.save(pg_temp.ann('{"name": "Main"}'));
  insert into ids values ('main', a);
  if pg_temp.mine('00000000-0000-4000-8000-0000000000f3', a) <> 1
    or pg_temp.mine('00000000-0000-4000-8000-0000000000f4', a) <> 1
    or pg_temp.mine('00000000-0000-4000-8000-0000000000f5', a) <> 1 then
    raise exception 'FAIL: t1, t2 or e1 does not get an announcement with no filters';
  end if;
  if pg_temp.mine('00000000-0000-4000-8000-0000000000f6', a) <> 0 then
    raise exception 'FAIL: a banned teacher got an announcement';
  end if;
  if pg_temp.key() is null then
    raise exception 'FAIL: announcements_key is empty while one is live';
  end if;
end;
$$;

-- ─── 3. Each filter, one at a time: t1 matches or not ─────────────────────────────────────────────────────────
do $$
declare
  a uuid := (select id from ids where name = 'main');
  t1 constant uuid := '00000000-0000-4000-8000-0000000000f3';
  e1 constant uuid := '00000000-0000-4000-8000-0000000000f5';
  c record;
begin
  for c in select * from (values
    ('{"genders": ["female"]}', t1, 1),
    ('{"genders": ["male"]}', t1, 0),
    ('{"age_min": 30, "age_max": 40}', t1, 1),
    ('{"age_min": 40}', t1, 0),
    ('{"provinces": ["Cebu"]}', t1, 1),
    ('{"provinces": ["Bohol"]}', t1, 0),
    ('{"town_words": ["mandaue"]}', t1, 1),
    ('{"town_words": ["lapu"]}', t1, 0),
    ('{"education_levels": ["master"]}', t1, 1),
    ('{"education_levels": ["doctorate"]}', t1, 0),
    ('{"field_words": ["ENGLISH", "filipino"]}', t1, 1),
    ('{"field_words": ["math"]}', t1, 0),
    ('{"presentations_min": 3, "presentations_max": 3}', t1, 1),
    ('{"presentations_min": 4}', t1, 0),
    ('{"roles": ["teacher"]}', t1, 1),
    ('{"roles": ["teacher"]}', e1, 0),
    ('{"roles": ["editor"]}', e1, 1)
  ) as v (filter, who, expected) loop
    perform pg_temp.save(pg_temp.ann('{"name": "Main"}') || jsonb_build_object('id', a) || c.filter::jsonb);
    if pg_temp.mine(c.who, a) <> c.expected then
      raise exception 'FAIL: filter % for % should give % row(s)', c.filter, c.who, c.expected;
    end if;
  end loop;
end;
$$;

-- ─── 4. A teacher with empty details doesn't match a filter on them ───────────────────────────────────────────
do $$
declare
  a uuid := (select id from ids where name = 'main');
  f text;
begin
  foreach f in array array[
    '{"age_min": 18}', '{"provinces": ["Cebu"]}', '{"town_words": ["a"]}', '{"education_levels": ["master"]}',
    '{"field_words": ["a"]}', '{"genders": ["female"]}'
  ] loop
    perform pg_temp.save(pg_temp.ann('{"name": "Main"}') || jsonb_build_object('id', a) || f::jsonb);
    if pg_temp.mine('00000000-0000-4000-8000-0000000000f4', a) <> 0 then
      raise exception 'FAIL: t2 (empty details) matched %', f;
    end if;
  end loop;
end;
$$;

-- ─── 5. The live window, and the key ──────────────────────────────────────────────────────────────────────────
do $$
declare
  a uuid := (select id from ids where name = 'main');
  t1 constant uuid := '00000000-0000-4000-8000-0000000000f3';
  key_before text;
begin
  perform pg_temp.save(pg_temp.ann('{"name": "Main", "is_on": false}') || jsonb_build_object('id', a));
  if pg_temp.mine(t1, a) <> 0 then
    raise exception 'FAIL: an announcement that is off was shown';
  end if;
  perform pg_temp.save(pg_temp.ann('{"name": "Main"}')
    || jsonb_build_object('id', a, 'starts_at', now() + interval '1 day'));
  if pg_temp.mine(t1, a) <> 0 or pg_temp.key() is not null then
    raise exception 'FAIL: an announcement starting tomorrow was shown, or it set the key';
  end if;
  perform pg_temp.save(pg_temp.ann('{"name": "Main"}')
    || jsonb_build_object('id', a, 'ends_at', now() - interval '1 hour'));
  if pg_temp.mine(t1, a) <> 0 or pg_temp.key() is not null then
    raise exception 'FAIL: an ended announcement was shown, or it set the key';
  end if;
  perform pg_temp.save(pg_temp.ann('{"name": "Main"}') || jsonb_build_object('id', a));
  key_before := pg_temp.key();
  perform pg_temp.save(pg_temp.ann('{"name": "Main", "modal_text": "Changed"}') || jsonb_build_object('id', a));
  if pg_temp.key() is null or pg_temp.key() = key_before then
    raise exception 'FAIL: the key did not change after an edit';
  end if;
end;
$$;

-- ─── 6. once: closing hides it for that teacher only; the modal and the bar close apart ───────────────────────
do $$
declare
  a uuid := (select id from ids where name = 'main');
  both_parts uuid;
  t1 constant uuid := '00000000-0000-4000-8000-0000000000f3';
  r record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  perform public.dismiss_announcement(a, 'modal');
  if pg_temp.mine(t1, a) <> 0 or pg_temp.mine('00000000-0000-4000-8000-0000000000f4', a) <> 1 then
    raise exception 'FAIL: once: closing did not hide it for t1 only';
  end if;

  both_parts := pg_temp.save(pg_temp.ann('{"name": "Both", "show_bar": true, "bar_html": "<p>Bar</p>"}'));
  insert into ids values ('both', both_parts);
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  perform public.dismiss_announcement(both_parts, 'modal');
  select * into r from public.my_announcements() m where m.id = both_parts;
  if r.id is null or r.show_modal or not r.show_bar then
    raise exception 'FAIL: closing the modal did not leave the bar';
  end if;
end;
$$;

-- ─── 7. daily: back after midnight, Philippine time ───────────────────────────────────────────────────────────
do $$
begin
  perform pg_temp.save(pg_temp.ann('{"name": "Main", "repeat": "daily"}')
    || jsonb_build_object('id', (select id from ids where name = 'main')));
end;
$$;

reset role;
update public.announcement_dismissals set closed_at = ((public.manila_today() - 1) + time '23:59') at time zone 'Asia/Manila'
where announcement_id = (select id from ids where name = 'main') and user_id = '00000000-0000-4000-8000-0000000000f3';
set local role authenticated;
do $$
begin
  if pg_temp.mine('00000000-0000-4000-8000-0000000000f3', (select id from ids where name = 'main')) <> 1 then
    raise exception 'FAIL: daily: closed yesterday but not shown today';
  end if;
end;
$$;

reset role;
update public.announcement_dismissals set closed_at = (public.manila_today() + time '00:01') at time zone 'Asia/Manila'
where announcement_id = (select id from ids where name = 'main') and user_id = '00000000-0000-4000-8000-0000000000f3';
set local role authenticated;
do $$
begin
  if pg_temp.mine('00000000-0000-4000-8000-0000000000f3', (select id from ids where name = 'main')) <> 0 then
    raise exception 'FAIL: daily: closed today but shown again';
  end if;
end;
$$;

-- ─── 8. every_visit: nothing saved, it always comes back ──────────────────────────────────────────────────────
do $$
declare
  a uuid := (select id from ids where name = 'main');
  t2 constant uuid := '00000000-0000-4000-8000-0000000000f4';
begin
  perform pg_temp.save(pg_temp.ann('{"name": "Main", "repeat": "every_visit"}') || jsonb_build_object('id', a));
  perform set_config('request.jwt.claims', json_build_object('sub', t2, 'role', 'authenticated')::text, true);
  perform public.dismiss_announcement(a, 'modal');
  if pg_temp.mine(t2, a) <> 1 then
    raise exception 'FAIL: every_visit: closing hid it';
  end if;
  -- t1's old dismissal (from once / daily) doesn't count any more either.
  if pg_temp.mine('00000000-0000-4000-8000-0000000000f3', a) <> 1 then
    raise exception 'FAIL: every_visit: an old dismissal still hides it';
  end if;
end;
$$;

reset role;
do $$
begin
  if exists (select 1 from public.announcement_dismissals where user_id = '00000000-0000-4000-8000-0000000000f4') then
    raise exception 'FAIL: every_visit wrote a dismissal';
  end if;
end;
$$;
set local role authenticated;

-- ─── 9. Limits ────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  bad text;
begin
  foreach bad in array array[
    '{"name": ""}',
    jsonb_build_object('name', repeat('x', 101))::text,
    '{"modal_close_after": 61}',
    '{"age_min": 17}',
    '{"age_min": 40, "age_max": 30}',
    '{"provinces": ["Atlantis"]}',
    jsonb_build_object('field_words', (select jsonb_agg('w' || g) from generate_series(1, 21) g))::text,
    '{"show_modal": false, "show_bar": false}',
    '{"show_bar": true, "bar_html": ""}',
    '{"pages": ["dashboard"]}',
    '{"pages": []}'
  ] loop
    if not pg_temp.refused(a1, format('select public.save_announcement(pg_temp.ann(%L))', bad)) then
      raise exception 'FAIL: a bad announcement was saved: %', bad;
    end if;
  end loop;
end;
$$;

-- At most 20 on and not ended: fill up to 20 (as postgres), then the 21st is refused (an off one is fine).
reset role;
insert into public.announcements (name, is_on, show_bar, bar_html)
select 'Filler ' || g, true, true, '<p>x</p>'
from generate_series(1, 20 - (select count(*)::int from public.announcements
  where is_on and (ends_at is null or ends_at > now()))) g;
set local role authenticated;
do $$
begin
  if not pg_temp.refused('00000000-0000-4000-8000-0000000000f1', 'select public.save_announcement(pg_temp.ann(''{}''))') then
    raise exception 'FAIL: a 21st announcement that is on was saved';
  end if;
  if pg_temp.refused('00000000-0000-4000-8000-0000000000f1',
    'select public.save_announcement(pg_temp.ann(''{"is_on": false}''))') then
    raise exception 'FAIL: an announcement that is off was refused at the limit';
  end if;
end;
$$;
reset role;
delete from public.announcements where name like 'Filler %' or (name = 'Test' and not is_on);
set local role authenticated;

-- ─── 10. admin_announcements: status, matched, closed ─────────────────────────────────────────────────────────
do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  main_id uuid := (select id from ids where name = 'main');
  scheduled uuid;
  ended uuid;
  off uuid;
  r record;
begin
  -- Main back to once, so t1's modal dismissal counts as closed.
  perform pg_temp.save(pg_temp.ann('{"name": "Main"}') || jsonb_build_object('id', main_id));
  scheduled := pg_temp.save(pg_temp.ann('{"name": "Later"}') || jsonb_build_object('starts_at', now() + interval '1 day'));
  ended := pg_temp.save(pg_temp.ann('{"name": "Done"}') || jsonb_build_object('ends_at', now() - interval '1 hour'));
  off := pg_temp.save(pg_temp.ann('{"name": "Off", "is_on": false}'));

  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  -- Saving doesn't count (20261224000000_announcement_fast_counts.sql); the app asks for it next, like this.
  perform public.recount_announcement(main_id);
  for r in select * from public.admin_announcements() loop
    if r.id = main_id and (r.status <> 'live'
      or r.matched <> (select accounts from before_test) + 5 or r.closed_modal <> 1 or r.closed_bar <> 0) then
      raise exception 'FAIL: admin_announcements row for Main is wrong: % matched %, closed %', r.status, r.matched, r.closed_modal;
    end if;
    if (r.id = scheduled and r.status <> 'scheduled') or (r.id = ended and r.status <> 'ended')
      or (r.id = off and r.status <> 'off') then
      raise exception 'FAIL: admin_announcements status % for %', r.status, r.name;
    end if;
  end loop;
  if (select count(*) from public.admin_announcements() x where x.id in (main_id, scheduled, ended, off)) <> 4 then
    raise exception 'FAIL: admin_announcements is missing rows';
  end if;

  -- ─── 11. announcement_audience ──────────────────────────────────────────────────────────────────────────────
  if public.announcement_audience('{"genders": ["female"]}') <> (select females from before_test) + 1 then
    raise exception 'FAIL: announcement_audience for female is %', public.announcement_audience('{"genders": ["female"]}');
  end if;

  -- set_announcement_on and delete_announcement
  perform set_config('quizmatter.admin_logged', '', true);
  perform public.set_announcement_on(off, true);
  if not (select x.is_on from public.admin_announcements() x where x.id = off) then
    raise exception 'FAIL: set_announcement_on did not turn it on';
  end if;
  perform set_config('quizmatter.admin_logged', '', true);
  perform public.delete_announcement(off);
  if exists (select 1 from public.admin_announcements() x where x.id = off) then
    raise exception 'FAIL: delete_announcement did not delete it';
  end if;
end;
$$;

-- ─── 12. A modal picture counts as a used photo ─────────────────────────────────────────────────────────────────────
do $$
begin
  perform pg_temp.save(pg_temp.ann('{"name": "Picture"}') || jsonb_build_object(
    'modal_attachment', '{"kind": "photo", "src": "https://images.quizmatter.com/uploads/abc.webp", "width": 800, "height": 600}'::jsonb));
end;
$$;

set local role service_role;
do $$
begin
  if not 'https://images.quizmatter.com/uploads/abc.webp' = any (public.used_photo_srcs()) then
    raise exception 'FAIL: used_photo_srcs does not keep a modal image';
  end if;
end;
$$;

-- ─── 13. The Admin log ────────────────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if not exists (select 1 from public.admin_actions where action = 'announcement_saved'
      and target_type = 'announcement' and admin_id = '00000000-0000-4000-8000-0000000000f1')
    or not exists (select 1 from public.admin_actions where action = 'announcement_deleted'
      and target_type = 'announcement' and admin_id = '00000000-0000-4000-8000-0000000000f1') then
    raise exception 'FAIL: the Admin log has no announcement_saved / announcement_deleted rows';
  end if;
end;
$$;

rollback;
