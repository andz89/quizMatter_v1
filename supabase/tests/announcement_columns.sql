-- Every announcements column is saved, and sent to teachers or marked admin only; an update keeps what the app
-- didn't send (supabase/migrations/20261231000400_announcement_columns.sql, spec
-- docs/superpowers/specs/2026-11-02-announcement-columns-design.md).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_columns.sql
-- Passes when it ends without an error. Everything is rolled back.
--
-- Adding a column: put it in save_announcement, then in my_announcements (teachers need it) or in admin_only below.
begin;

-- 1-3. The columns (read as postgres: the function sources and the table's columns).
do $$
declare
  admin_only constant text[] := array[
    'name', 'is_on', 'starts_at', 'ends_at', 'genders', 'age_min', 'age_max', 'education_levels', 'field_words',
    'presentations_min', 'presentations_max', 'roles', 'created_by', 'updated_at', 'matched_count',
    'closed_modal_count', 'closed_bar_count', 'counted_at', 'closed_cleared_at'
  ];
  -- Set by the database, never by the admin's save.
  server_managed constant text[] := array[
    'id', 'created_by', 'created_at', 'updated_at', 'matched_count', 'closed_modal_count', 'closed_bar_count',
    'counted_at', 'closed_cleared_at'
  ];
  to_teachers text[];
  save_def text := pg_get_functiondef('public.save_announcement(jsonb, boolean)'::regprocedure);
  insert_list text;
  update_list text;
  col text;
begin
  select array_agg(n) into to_teachers
  from pg_proc p, unnest(p.proargnames, p.proargmodes) as x(n, m)
  where p.oid = 'public.my_announcements()'::regprocedure and m in ('t', 'o');
  -- A check that finds nothing to read would pass every column: fail loudly instead.
  if coalesce(cardinality(to_teachers), 0) = 0 then
    raise exception 'FAIL: could not read my_announcements'' columns';
  end if;

  insert_list := substring(save_def from 'insert into public\.announcements \(([^)]*)\)');
  -- Only the update's own set list counts (not a "col =" anywhere else in the function).
  update_list := substring(save_def from 'update public\.announcements x set(.*?)where x\.id');
  if insert_list is null or update_list is null then
    raise exception 'FAIL: could not read save_announcement''s insert or update list';
  end if;
  for col in
    select c.column_name from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'announcements' order by c.ordinal_position
  loop
    if not (col = any (to_teachers) or col = any (admin_only)) then
      raise exception 'FAIL: column % is neither sent to teachers nor marked admin only', col;
    end if;
    if not col = any (server_managed)
      and (update_list !~ ('\m' || col || '\s*=') or insert_list !~ ('\m' || col || '\M')) then
      raise exception 'FAIL: save_announcement does not save %', col;
    end if;
  end loop;

  if pg_get_function_result('public.admin_announcements()'::regprocedure) <> 'SETOF announcements' then
    raise exception 'FAIL: admin_announcements no longer returns the table''s rows';
  end if;
end;
$$;

-- 4-6. An update keeps what the app didn't send, clears what it sends as null, and never sets the counts.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000004e1', 'columns-super@example.com', '{"first_name": "Columns", "last_name": "Super"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000004e1', true);

create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Columns', 'is_on', false, 'starts_at', null, 'ends_at', null,
    'show_modal', true, 'modal_format', 'post', 'modal_text', 'Hi', 'modal_attachment', null,
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

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

do $$
declare
  s1 constant uuid := '00000000-0000-4000-8000-0000000004e1';
  box uuid;
  r record;
begin
  perform pg_temp.act_as(s1);
  box := public.save_announcement(pg_temp.ann(jsonb_build_object('ends_at', now() + interval '1 day')));

  -- 4. An older tab's update, without the corner keys: they stay.
  perform pg_temp.act_as(s1);
  perform public.save_announcement(
    pg_temp.ann(jsonb_build_object('id', box, 'ends_at', now() + interval '1 day')) - 'modal_display' - 'modal_auto_close');
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = box;
  if r.modal_display is distinct from 'corner' or r.modal_auto_close <> 30 then
    raise exception 'FAIL: an update without the corner keys gave % / %', r.modal_display, r.modal_auto_close;
  end if;

  -- 5. ends_at sent as null clears it.
  perform pg_temp.act_as(s1);
  perform public.save_announcement(pg_temp.ann(jsonb_build_object('id', box, 'ends_at', null)));
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = box;
  if r.ends_at is not null then
    raise exception 'FAIL: ends_at sent as null was kept: %', r.ends_at;
  end if;

  -- 6. A count sent in the JSON is not saved.
  perform pg_temp.act_as(s1);
  perform public.save_announcement(pg_temp.ann(jsonb_build_object('id', box, 'matched_count', 999)));
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = box;
  if r.matched_count is not distinct from 999 then
    raise exception 'FAIL: a save set matched_count';
  end if;

  -- 7. "A modal or a top bar, not both" is checked on the merged row: an update that leaves out show_bar can't
  -- turn a top bar into one showing both.
  perform pg_temp.act_as(s1);
  perform public.save_announcement(pg_temp.ann(jsonb_build_object(
    'id', box, 'show_modal', false, 'modal_text', '', 'modal_display', 'center', 'modal_auto_close', 0,
    'show_bar', true, 'bar_html', '<p>Bar</p>')));
  begin
    perform pg_temp.act_as(s1);
    perform public.save_announcement(jsonb_build_object('id', box, 'show_modal', true, 'modal_text', 'Hi'));
    raise exception 'FAIL: an update without show_bar saved a modal and a bar together';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

rollback;
