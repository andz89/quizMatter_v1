-- A modal or corner box shows after N seconds in the tab (0 = at once); a top bar always at once
-- (supabase/migrations/20261231000600_announcement_show_after.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_show_after.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- s1 super admin, t1 teacher.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000004f1', 'wait-super@example.com', '{"first_name": "Wait", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000004f3', 'wait-teacher@example.com', '{"first_name": "Wait", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000004f1', true);

-- A modal that waits 20 seconds and is off; `extra` replaces some keys.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Wait', 'is_on', false, 'starts_at', null, 'ends_at', null,
    'show_modal', true, 'modal_format', 'post', 'modal_text', 'Hello later', 'modal_attachment', null,
    'modal_close_after', 0, 'modal_size', 'large', 'modal_html', '', 'modal_height', 400,
    'modal_display', 'center', 'modal_auto_close', 0, 'modal_show_after', 20,
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

-- Saves as the super admin and returns the id.
create function pg_temp.save(a jsonb) returns uuid language plpgsql as $$
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000004f1');
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

-- The saved wait (read as the super admin).
create function pg_temp.wait_of(target uuid) returns int language plpgsql as $$
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000004f1');
  return (select a.modal_show_after from public.admin_announcements() a where a.id = target);
end;
$$;

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

do $$
declare
  t1 constant uuid := '00000000-0000-4000-8000-0000000004f3';
  modal uuid;
  box uuid;
  bar uuid;
  older uuid;
  bad text;
begin
  -- 1. Saved, and the teacher gets the wait with the modal.
  modal := pg_temp.save(pg_temp.ann('{"is_on": true}'));
  if pg_temp.wait_of(modal) is distinct from 20 then
    raise exception 'FAIL: admin_announcements gave %', pg_temp.wait_of(modal);
  end if;
  perform pg_temp.act_as(t1);
  if (select m.modal_show_after from public.my_announcements() m where m.id = modal) is distinct from 20 then
    raise exception 'FAIL: my_announcements did not send the wait';
  end if;

  -- 2. A corner box waits too, up to 600 seconds.
  box := pg_temp.save(pg_temp.ann('{"modal_display": "corner", "modal_size": "small", "modal_show_after": 600}'));
  if pg_temp.wait_of(box) is distinct from 600 then
    raise exception 'FAIL: a corner box did not keep 600';
  end if;

  -- 3. Out of range: refused by the table's rule.
  foreach bad in array array['{"modal_show_after": -1}', '{"modal_show_after": 601}'] loop
    if pg_temp.code(pg_temp.ann(bad::jsonb)) is distinct from '23514' then
      raise exception 'FAIL: a bad wait was not refused by a table rule: %', bad;
    end if;
  end loop;

  -- 4. A top bar shows at once: a wait sent with it is emptied.
  bar := pg_temp.save(pg_temp.ann(
    '{"name": "Bar", "show_modal": false, "modal_text": "", "show_bar": true, "bar_html": "<p>Hi</p>", "modal_show_after": 30}'));
  if pg_temp.wait_of(bar) is distinct from 0 then
    raise exception 'FAIL: a top bar kept a wait of %', pg_temp.wait_of(bar);
  end if;

  -- 5. A save without the key (an older app tab) shows at once; an update without it keeps the wait.
  older := pg_temp.save(pg_temp.ann('{"name": "Older"}') - 'modal_show_after');
  if pg_temp.wait_of(older) is distinct from 0 then
    raise exception 'FAIL: an older save gave %', pg_temp.wait_of(older);
  end if;
  perform pg_temp.save(pg_temp.ann(jsonb_build_object('id', modal, 'is_on', true)) - 'modal_show_after');
  if pg_temp.wait_of(modal) is distinct from 20 then
    raise exception 'FAIL: an update without the key changed the wait to %', pg_temp.wait_of(modal);
  end if;
end;
$$;

rollback;
