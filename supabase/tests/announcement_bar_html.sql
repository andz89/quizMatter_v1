-- HTML top bar in a sealed box (supabase/migrations/20261231000000_announcement_bar_html.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_bar_html.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- s1 super admin, t1 teacher.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000004a1', 'bar-html-super@example.com', '{"first_name": "Bar", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000004a3', 'bar-html-teacher@example.com', '{"first_name": "Bar", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000004a1', true);

-- An html top bar that is on; `extra` replaces some keys.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Html bar', 'is_on', true, 'starts_at', null, 'ends_at', null,
    'show_modal', false, 'modal_text', '', 'modal_attachment', null, 'modal_close_after', 0,
    'show_bar', true, 'bar_format', 'html', 'bar_height', 80, 'bar_close_after', 0,
    'bar_html', '<b>Hi</b><img src="https://images.quizmatter.com/uploads/in-bar.gif">' || repeat(' ', 1200),
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
create function pg_temp.code(a jsonb) returns text language plpgsql as $$
begin
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000004a1');
  perform public.save_announcement(a, true);
  return null;
exception when others then
  return sqlstate;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

do $$
declare
  s1 constant uuid := '00000000-0000-4000-8000-0000000004a1';
  ours constant text := 'https://images.quizmatter.com/uploads/';
  saved uuid;
  older uuid;
  r record;
  bad text;
begin
  -- 1. Saved (over 1,000 characters is fine for html), and the teacher gets the format and the height.
  perform pg_temp.act_as(s1);
  saved := public.save_announcement(pg_temp.ann('{}'), true);
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000004a3');
  select * into r from public.my_announcements() m where m.id = saved;
  if r.bar_format is distinct from 'html' or r.bar_height <> 80 or r.bar_html not like '<b>Hi</b>%' then
    raise exception 'FAIL: my_announcements gave % / %', r.bar_format, r.bar_height;
  end if;
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = saved;
  if r.bar_format is distinct from 'html' or r.bar_height <> 80 then
    raise exception 'FAIL: admin_announcements gave % / %', r.bar_format, r.bar_height;
  end if;

  -- 2. A save without the new keys (an older app tab) is a text bar, 60 high.
  perform pg_temp.act_as(s1);
  older := public.save_announcement(pg_temp.ann('{"name": "Older", "bar_html": "<p>Plain</p>"}') - 'bar_format' - 'bar_height', true);
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = older;
  if r.bar_format is distinct from 'text' or r.bar_height <> 60 then
    raise exception 'FAIL: an older save gave % / %', r.bar_format, r.bar_height;
  end if;

  -- 3. 100,000 characters save (20261231000100_announcement_html_limit.sql).
  if pg_temp.code(pg_temp.ann(jsonb_build_object('bar_html', repeat('x', 100000)))) is not null then
    raise exception 'FAIL: an html bar of 100,000 characters was refused';
  end if;

  -- Refused: a text bar over 1,000, html over 100,000, a bad format, a height out of range.
  foreach bad in array array[
    jsonb_build_object('bar_format', 'text', 'bar_html', '<p>' || repeat('x', 1000) || '</p>')::text,
    jsonb_build_object('bar_html', repeat('x', 100001))::text,
    '{"bar_format": "script"}',
    '{"bar_height": 29}',
    '{"bar_height": 301}'
  ] loop
    if pg_temp.code(pg_temp.ann(bad::jsonb)) is null then
      raise exception 'FAIL: a bad html bar was saved: %', left(bad, 80);
    end if;
  end loop;

  -- 4. A Photos-tab photo whose address is in the bar's html counts as used.
  perform pg_temp.act_as(s1);
  perform public.add_announcement_photo(ours || 'in-bar.gif', 100, 100);
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcement_photos() p where p.src = ours || 'in-bar.gif';
  if r.used_by is distinct from array['Html bar'] then
    raise exception 'FAIL: the photo in the bar is used by %', r.used_by;
  end if;
  perform pg_temp.act_as(s1);
  begin
    perform public.delete_announcement_photo(ours || 'in-bar.gif');
    raise exception 'FAIL: a photo used in the bar was deleted';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

-- 5. The cleanup keeps an address written in an html bar.
reset role;
do $$
begin
  update public.announcements set bar_html = '<img src="https://images.quizmatter.com/uploads/bar-only.webp">'
  where name = 'Html bar';
  if not 'https://images.quizmatter.com/uploads/bar-only.webp' = any (public.used_photo_srcs()) then
    raise exception 'FAIL: used_photo_srcs does not keep a photo in an html bar';
  end if;
end;
$$;

rollback;
