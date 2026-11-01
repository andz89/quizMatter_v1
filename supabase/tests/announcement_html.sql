-- HTML modal in a sealed box (supabase/migrations/20261230000000_announcement_html.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_html.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- s1 super admin, t1 teacher.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000003a1', 'html-super@example.com', '{"first_name": "Html", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000003a3', 'html-teacher@example.com', '{"first_name": "Html", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000003a1', true);

-- An html modal that is on; `extra` replaces some keys.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select '{
    "name": "Html", "is_on": true, "starts_at": null, "ends_at": null,
    "show_modal": true, "modal_format": "html", "modal_text": "", "modal_attachment": null,
    "modal_html": "<h1>Hi</h1><img src=\"https://images.quizmatter.com/uploads/in-html.gif\">",
    "modal_height": 300, "modal_close_after": 0,
    "show_bar": false, "bar_html": "", "bar_close_after": 0,
    "repeat": "once", "pages": ["all"],
    "genders": [], "age_min": null, "age_max": null,
    "education_levels": [], "field_words": [], "presentations_min": null, "presentations_max": null, "roles": []
  }'::jsonb || extra;
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
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000003a1');
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
  s1 constant uuid := '00000000-0000-4000-8000-0000000003a1';
  ours constant text := 'https://images.quizmatter.com/uploads/';
  saved uuid;
  older uuid;
  r record;
  bad text;
begin
  -- 1. Saved, and the teacher gets the html, the format and the height.
  perform pg_temp.act_as(s1);
  saved := public.save_announcement(pg_temp.ann('{}'), true);
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000003a3');
  select * into r from public.my_announcements() m where m.id = saved;
  if r.modal_format is distinct from 'html' or r.modal_height <> 300 or r.modal_html not like '<h1>Hi</h1>%' then
    raise exception 'FAIL: my_announcements gave %', row_to_json(r);
  end if;
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = saved;
  if r.modal_format is distinct from 'html' or r.modal_height <> 300 or r.modal_html = '' then
    raise exception 'FAIL: admin_announcements gave %', row_to_json(r);
  end if;

  -- 2. A save without the new keys (an older app tab) is a post with the defaults.
  perform pg_temp.act_as(s1);
  older := public.save_announcement(pg_temp.ann('{"name": "Older", "modal_text": "Plain"}')
    - 'modal_format' - 'modal_html' - 'modal_height', true);
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = older;
  if r.modal_format is distinct from 'post' or r.modal_height <> 400 or r.modal_html <> '' then
    raise exception 'FAIL: an older save gave %', row_to_json(r);
  end if;

  -- 3. 100,000 characters save (20261231000100_announcement_html_limit.sql).
  if pg_temp.code(pg_temp.ann(jsonb_build_object('modal_html', repeat('x', 100000)))) is not null then
    raise exception 'FAIL: an html modal of 100,000 characters was refused';
  end if;

  -- Refused: an empty html modal, a bad format, a height out of range, html too long.
  foreach bad in array array[
    '{"modal_html": "  "}',
    '{"modal_format": "script"}',
    '{"modal_height": 99}',
    '{"modal_height": 1001}',
    jsonb_build_object('modal_html', repeat('x', 100001))::text
  ] loop
    if pg_temp.code(pg_temp.ann(bad::jsonb)) is null then
      raise exception 'FAIL: a bad html modal was saved: %', left(bad, 80);
    end if;
  end loop;

  -- 4. A Photos-tab photo whose address is in the html counts as used: listed with it, and can't be deleted.
  perform pg_temp.act_as(s1);
  perform public.add_announcement_photo(ours || 'in-html.gif', 100, 100);
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcement_photos() p where p.src = ours || 'in-html.gif';
  if r.used_by is distinct from array['Html'] then
    raise exception 'FAIL: the photo in the html is used by %', r.used_by;
  end if;
  perform pg_temp.act_as(s1);
  begin
    perform public.delete_announcement_photo(ours || 'in-html.gif');
    raise exception 'FAIL: a photo used in the html was deleted';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

-- 5. The cleanup keeps an address written in the html, even one not on the Photos tab.
reset role;
do $$
begin
  update public.announcements set modal_html = '<img src="https://images.quizmatter.com/uploads/not-listed.webp">'
  where name = 'Html';
  if not 'https://images.quizmatter.com/uploads/not-listed.webp' = any (public.used_photo_srcs()) then
    raise exception 'FAIL: used_photo_srcs does not keep a photo in the html';
  end if;
end;
$$;

rollback;
