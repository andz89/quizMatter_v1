-- "Again every N minutes": repeat 'interval' with repeat_minutes 1–1,440 (0 for every other repeat), remembered only
-- in the teacher's tab (supabase/migrations/20261231000700_announcement_interval.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_interval.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- s1 super admin, t1 teacher.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000501', 'interval-super@example.com', '{"first_name": "Interval", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-000000000503', 'interval-teacher@example.com', '{"first_name": "Interval", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-000000000501', true);

-- A modal shown again every 11 minutes, off; `extra` replaces some keys.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Interval', 'is_on', false, 'starts_at', null, 'ends_at', null,
    'show_modal', true, 'modal_format', 'post', 'modal_text', 'Again and again', 'modal_attachment', null,
    'modal_close_after', 0, 'modal_size', 'large', 'modal_html', '', 'modal_height', 400,
    'modal_display', 'center', 'modal_auto_close', 0, 'modal_show_after', 0,
    'show_bar', false, 'bar_format', 'text', 'bar_html', '', 'bar_height', 60, 'bar_close_after', 0,
    'repeat', 'interval', 'repeat_minutes', 11, 'pages', jsonb_build_array('all'),
    'genders', '[]'::jsonb, 'age_min', null, 'age_max', null, 'education_levels', '[]'::jsonb,
    'field_words', '[]'::jsonb, 'presentations_min', null, 'presentations_max', null, 'roles', '[]'::jsonb
  ) || extra;
$$;

create function pg_temp.act_as(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  perform set_config('quizmatter.admin_logged', '', true);
end;
$$;

-- Saves as the super admin and returns the id.
create function pg_temp.save(a jsonb) returns uuid language plpgsql as $$
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-000000000501');
  return public.save_announcement(a, true);
end;
$$;

-- The error code saving it raised, or null when it saved.
create function pg_temp.code(a jsonb) returns text language plpgsql as $$
begin
  perform pg_temp.save(a);
  return null;
exception when others then
  return sqlstate;
end;
$$;

-- The saved minutes (read as the super admin).
create function pg_temp.minutes_of(target uuid) returns int language plpgsql as $$
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-000000000501');
  return (select a.repeat_minutes from public.admin_announcements() a where a.id = target);
end;
$$;

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

do $$
declare
  t1 constant uuid := '00000000-0000-4000-8000-000000000503';
  every11 uuid;
  older uuid;
  bad text;
  r record;
begin
  -- 1. Saved, and the teacher gets the repeat and its minutes.
  every11 := pg_temp.save(pg_temp.ann('{"is_on": true}'));
  if pg_temp.minutes_of(every11) is distinct from 11 then
    raise exception 'FAIL: admin_announcements gave %', pg_temp.minutes_of(every11);
  end if;
  perform pg_temp.act_as(t1);
  select * into r from public.my_announcements() m where m.id = every11;
  if r.repeat is distinct from 'interval' or r.repeat_minutes is distinct from 11 then
    raise exception 'FAIL: my_announcements gave % / %', r.repeat, r.repeat_minutes;
  end if;

  -- 2. Refused by the table's rule: no minutes, too many, minutes on another repeat, below zero.
  foreach bad in array array[
    '{"repeat_minutes": 0}',
    '{"repeat_minutes": 1441}',
    '{"repeat_minutes": -1}',
    '{"repeat": "once", "repeat_minutes": 15}'
  ] loop
    if pg_temp.code(pg_temp.ann(bad::jsonb)) is distinct from '23514' then
      raise exception 'FAIL: bad minutes were not refused by a table rule: %', bad;
    end if;
  end loop;

  -- 3. The edges save.
  if pg_temp.code(pg_temp.ann('{"name": "One", "repeat_minutes": 1}')) is not null
    or pg_temp.code(pg_temp.ann('{"name": "Day", "repeat_minutes": 1440}')) is not null then
    raise exception 'FAIL: 1 or 1,440 minutes was refused';
  end if;

  -- 4. A save without the key (an older app tab) is 0; an update without it keeps the minutes.
  older := pg_temp.save(pg_temp.ann('{"name": "Older", "repeat": "once"}') - 'repeat_minutes');
  if pg_temp.minutes_of(older) is distinct from 0 then
    raise exception 'FAIL: an older save gave %', pg_temp.minutes_of(older);
  end if;
  perform pg_temp.save(pg_temp.ann(jsonb_build_object('id', every11, 'is_on', true)) - 'repeat_minutes');
  if pg_temp.minutes_of(every11) is distinct from 11 then
    raise exception 'FAIL: an update without the key changed the minutes to %', pg_temp.minutes_of(every11);
  end if;

  -- 5. Closing it saves nothing about the teacher: it is still sent (remembered only in the tab).
  perform pg_temp.act_as(t1);
  perform public.dismiss_announcement(every11, 'modal');
  perform pg_temp.act_as(t1);
  if not exists (select 1 from public.my_announcements() m where m.id = every11 and m.show_modal) then
    raise exception 'FAIL: closing an every-N-minutes announcement saved a closed record';
  end if;
end;
$$;

rollback;
