-- The announcement modal's size (supabase/migrations/20261222000000_announcement_modal_size.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_modal_size.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): s1 super admin, t1 teacher ──────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'size-super@example.com', '{"first_name": "Size", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'size-t1@example.com', '{"first_name": "Size", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000e1', true);

-- An announcement with every key but modal_size: modal only, once, all pages, no filters.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select '{
    "name": "Size test", "is_on": true, "starts_at": null, "ends_at": null,
    "show_modal": true, "modal_html": "<p>Hello</p>", "modal_close_after": 0,
    "show_bar": false, "bar_html": "", "bar_close_after": 0,
    "repeat": "once", "pages": ["all"],
    "genders": [], "age_min": null, "age_max": null, "provinces": [], "town_words": [],
    "education_levels": [], "field_words": [], "presentations_min": null, "presentations_max": null, "roles": []
  }'::jsonb || extra;
$$;

-- Saves as the super admin; returns the id.
create function pg_temp.save(a jsonb) returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
  perform set_config('quizmatter.admin_logged', '', true);
  return public.save_announcement(a);
end;
$$;

-- The size t1 gets for this announcement, and the size the admin list shows.
create function pg_temp.teacher_size(target uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);
  return (select m.modal_size from public.my_announcements() m where m.id = target);
end;
$$;
create function pg_temp.admin_size(target uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
  return (select a.modal_size from public.admin_announcements() a where a.id = target);
end;
$$;

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

do $$
declare
  small_id uuid;
  old_id uuid;
  was_refused boolean := false;
begin
  -- 1. A chosen size is saved, and teachers and the admin list get it back.
  small_id := pg_temp.save(pg_temp.ann('{"modal_size": "small"}'));
  if pg_temp.teacher_size(small_id) is distinct from 'small' then
    raise exception 'FAIL: my_announcements gave % instead of small', pg_temp.teacher_size(small_id);
  end if;
  if pg_temp.admin_size(small_id) is distinct from 'small' then
    raise exception 'FAIL: admin_announcements gave % instead of small', pg_temp.admin_size(small_id);
  end if;

  -- 2. A save without a size (an older app tab) is large, the size modals had before.
  old_id := pg_temp.save(pg_temp.ann('{}'));
  if pg_temp.teacher_size(old_id) is distinct from 'large' then
    raise exception 'FAIL: a save without a size gave % instead of large', pg_temp.teacher_size(old_id);
  end if;

  -- 3. An unknown size is refused.
  begin
    perform pg_temp.save(pg_temp.ann('{"modal_size": "huge"}'));
  exception when others then
    was_refused := true;
  end;
  if not was_refused then
    raise exception 'FAIL: modal_size huge was saved';
  end if;
end;
$$;

rollback;
