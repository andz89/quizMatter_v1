-- The corner box: a modal shown at the bottom-right that can close itself
-- (supabase/migrations/20261231000300_announcement_corner_box.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_corner_box.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- s1 super admin, t1 teacher.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000004d1', 'corner-super@example.com', '{"first_name": "Corner", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000004d3', 'corner-teacher@example.com', '{"first_name": "Corner", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000004d1', true);

-- A corner box that is on; `extra` replaces some keys.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Corner', 'is_on', true, 'starts_at', null, 'ends_at', null,
    'show_modal', true, 'modal_format', 'post', 'modal_text', 'Hello from the corner', 'modal_attachment', null,
    'modal_close_after', 0, 'modal_size', 'small', 'modal_html', '', 'modal_height', 400,
    'modal_display', 'corner', 'modal_auto_close', 30,
    'show_bar', false, 'bar_format', 'text', 'bar_html', '', 'bar_height', 60, 'bar_close_after', 0,
    'repeat', 'once', 'pages', jsonb_build_array('all'),
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

-- The error code saving it raised, or null when it saved.
create function pg_temp.code(a jsonb, replace_current boolean default true) returns text language plpgsql as $$
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000004d1');
  perform public.save_announcement(a, replace_current);
  return null;
exception when others then
  return sqlstate;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

do $$
declare
  s1 constant uuid := '00000000-0000-4000-8000-0000000004d1';
  t1 constant uuid := '00000000-0000-4000-8000-0000000004d3';
  box uuid;
  second_box uuid;
  third_box uuid;
  modal uuid;
  bar uuid;
  older uuid;
  r record;
  bad text;
begin
  -- 1. Saved, and the admin and the teacher get its display and timer.
  perform pg_temp.act_as(s1);
  box := public.save_announcement(pg_temp.ann('{}'), false);
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = box;
  if r.modal_display is distinct from 'corner' or r.modal_auto_close <> 30 then
    raise exception 'FAIL: admin_announcements gave % / %', r.modal_display, r.modal_auto_close;
  end if;
  perform pg_temp.act_as(t1);
  select * into r from public.my_announcements() m where m.id = box;
  if r.modal_display is distinct from 'corner' or r.modal_auto_close <> 30 then
    raise exception 'FAIL: my_announcements gave % / %', r.modal_display, r.modal_auto_close;
  end if;

  -- 2. Refused: a Large corner box, a bad display, a timer out of range, a timer on a centered modal.
  foreach bad in array array[
    '{"modal_size": "large"}',
    '{"modal_display": "side"}',
    '{"modal_auto_close": 4}',
    '{"modal_auto_close": 601}',
    '{"modal_display": "center", "modal_auto_close": 10}'
  ] loop
    if pg_temp.code(pg_temp.ann(bad::jsonb || '{"is_on": false}')) is distinct from '23514' then
      raise exception 'FAIL: a bad corner box was not refused by a table rule: %', bad;
    end if;
  end loop;

  -- 3. A save without the two keys (an older app tab) is a centered modal that never closes itself.
  perform pg_temp.act_as(s1);
  older := public.save_announcement(
    pg_temp.ann('{"name": "Older", "is_on": false, "modal_size": "large"}') - 'modal_display' - 'modal_auto_close', false);
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = older;
  if r.modal_display is distinct from 'center' or r.modal_auto_close <> 0 then
    raise exception 'FAIL: an older save gave % / %', r.modal_display, r.modal_auto_close;
  end if;

  -- 4. One centered modal, one bar and one corner box are on together.
  perform pg_temp.act_as(s1);
  modal := public.save_announcement(
    pg_temp.ann('{"name": "Center", "modal_display": "center", "modal_auto_close": 0, "modal_size": "large"}'), false);
  perform pg_temp.act_as(s1);
  bar := public.save_announcement(pg_temp.ann(
    '{"name": "Bar", "show_modal": false, "modal_text": "", "modal_display": "center", "modal_auto_close": 0, "show_bar": true, "bar_html": "<p>Hi</p>"}'),
    false);
  perform pg_temp.act_as(s1);
  if (select count(*) from public.admin_announcements() a where a.is_on) <> 3 then
    raise exception 'FAIL: a modal, a bar and a corner box are not all on';
  end if;

  -- 5. A second corner box is a conflict; with replace_current it swaps.
  if pg_temp.code(pg_temp.ann('{"name": "Second"}'), false) is distinct from 'QMONE' then
    raise exception 'FAIL: a second corner box was not refused with QMONE';
  end if;
  perform pg_temp.act_as(s1);
  second_box := public.save_announcement(pg_temp.ann('{"name": "Second"}'), true);
  perform pg_temp.act_as(s1);
  if (select a.is_on from public.admin_announcements() a where a.id = box) then
    raise exception 'FAIL: replace_current did not turn the first corner box off';
  end if;
  perform pg_temp.act_as(s1);
  if not (select a.is_on from public.admin_announcements() a where a.id = modal) then
    raise exception 'FAIL: a corner box turned the centered modal off';
  end if;

  -- 6. From the list: a third corner box conflicts; the centered modal doesn't conflict with a corner box.
  perform pg_temp.act_as(s1);
  third_box := public.save_announcement(pg_temp.ann('{"name": "Third", "is_on": false}'), false);
  perform pg_temp.act_as(s1);
  begin
    perform public.set_announcement_on(third_box, true, false);
    raise exception 'FAIL: turning on a third corner box from the list was not refused';
  exception when sqlstate 'QMONE' then
    null;
  end;
  perform pg_temp.act_as(s1);
  perform public.set_announcement_on(modal, false, false);
  perform pg_temp.act_as(s1);
  perform public.set_announcement_on(modal, true, false);

  -- 7. Closing it (button or by itself) is part 'modal': once closed, it isn't sent again.
  perform pg_temp.act_as(t1);
  if not exists (select 1 from public.my_announcements() m where m.id = second_box) then
    raise exception 'FAIL: the teacher does not get the corner box that is on';
  end if;
  perform pg_temp.act_as(t1);
  perform public.dismiss_announcement(second_box, 'modal');
  perform pg_temp.act_as(t1);
  if exists (select 1 from public.my_announcements() m where m.id = second_box) then
    raise exception 'FAIL: a closed corner box is sent again';
  end if;
end;
$$;

rollback;
