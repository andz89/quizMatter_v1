-- Announcement photos (supabase/migrations/20261229000000_announcement_photos.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_photos.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- s1 super admin, a2 plain admin, t1 teacher.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000002a1', 'ap-super@example.com', '{"first_name": "Ap", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000002a2', 'ap-admin@example.com', '{"first_name": "Ap", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000002a3', 'ap-teacher@example.com', '{"first_name": "Ap", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000002a1', true),
  ('00000000-0000-4000-8000-0000000002a2', false);

create function pg_temp.act_as(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('quizmatter.admin_logged', '', true);
end;
$$;

-- The error code a step raised as this user, or null when it worked.
create function pg_temp.code(who uuid, step text) returns text language plpgsql as $$
begin
  perform pg_temp.act_as(who);
  execute step;
  return null;
exception when others then
  return sqlstate;
end;
$$;

-- Read as postgres (only the functions read the table).
create function pg_temp.rows(photo text) returns int language sql security definer as $$
  select count(*)::int from public.announcement_photos where src = photo;
$$;
create function pg_temp.kept(photo text) returns boolean language sql security definer as $$
  select photo = any (public.used_photo_srcs());
$$;

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

do $$
declare
  s1 constant uuid := '00000000-0000-4000-8000-0000000002a1';
  ours constant text := 'https://images.quizmatter.com/uploads/';
  who uuid;
  step text;
  r record;
begin
  -- 1. Only the super admin.
  foreach who in array array['00000000-0000-4000-8000-0000000002a2', '00000000-0000-4000-8000-0000000002a3']::uuid[] loop
    foreach step in array array[
      format('select public.add_announcement_photo(%L, 10, 10)', ours || 'a.webp'),
      'select * from public.admin_announcement_photos()',
      format('select public.delete_announcement_photo(%L)', ours || 'a.webp')
    ] loop
      if pg_temp.code(who, step) is distinct from '42501' then
        raise exception 'FAIL: % was allowed: %', who, step;
      end if;
    end loop;
  end loop;

  -- 2. Added once, however many times; only our own addresses.
  perform pg_temp.act_as(s1);
  perform public.add_announcement_photo(ours || 'a.webp', 800, 600);
  perform pg_temp.act_as(s1);
  perform public.add_announcement_photo(ours || 'a.webp', 800, 600);
  if pg_temp.rows(ours || 'a.webp') <> 1 then
    raise exception 'FAIL: the same photo was listed % times', pg_temp.rows(ours || 'a.webp');
  end if;
  if pg_temp.code(s1, 'select public.add_announcement_photo(''https://evil.example/a.webp'', 10, 10)') is null
    or pg_temp.code(s1, format('select public.add_announcement_photo(%L, 0, 10)', ours || 'b.webp')) is null then
    raise exception 'FAIL: a bad photo was listed';
  end if;

  -- 3. Kept by the cleanup while listed, and listed for the super admin with who uses it.
  if not pg_temp.kept(ours || 'a.webp') then
    raise exception 'FAIL: used_photo_srcs does not keep a listed photo';
  end if;
  perform pg_temp.act_as(s1);
  perform public.save_announcement(jsonb_build_object(
    'name', 'Uses A', 'is_on', false, 'starts_at', null, 'ends_at', null,
    'show_modal', true, 'modal_text', '', 'modal_close_after', 0,
    'modal_attachment', jsonb_build_object('kind', 'photo', 'src', ours || 'a.webp', 'width', 800, 'height', 600),
    'show_bar', false, 'bar_html', '', 'bar_close_after', 0, 'repeat', 'once', 'pages', jsonb_build_array('all'),
    'genders', '[]'::jsonb, 'age_min', null, 'age_max', null, 'education_levels', '[]'::jsonb,
    'field_words', '[]'::jsonb, 'presentations_min', null, 'presentations_max', null, 'roles', '[]'::jsonb));
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcement_photos() p where p.src = ours || 'a.webp';
  if r.src is null or r.width <> 800 or r.height <> 600 or r.used_by is distinct from array['Uses A'] then
    raise exception 'FAIL: admin_announcement_photos gave %', row_to_json(r);
  end if;

  -- 4. Delete is refused while an announcement uses it; then it works and the cleanup may take the file.
  if pg_temp.code(s1, format('select public.delete_announcement_photo(%L)', ours || 'a.webp')) is distinct from '22023' then
    raise exception 'FAIL: a photo an announcement uses was deleted';
  end if;
  perform pg_temp.act_as(s1);
  perform public.add_announcement_photo(ours || 'c.gif', 100, 100);
  perform pg_temp.act_as(s1);
  perform public.delete_announcement_photo(ours || 'c.gif');
  if pg_temp.rows(ours || 'c.gif') <> 0 or pg_temp.kept(ours || 'c.gif') then
    raise exception 'FAIL: delete left the photo listed or kept';
  end if;
end;
$$;

-- 5. At most 500: fill up to 500 as postgres, then the next is refused; one already listed still saves.
reset role;
insert into public.announcement_photos (src, width, height)
select 'https://images.quizmatter.com/uploads/fill-' || g || '.webp', 10, 10
from generate_series(1, 500 - (select count(*)::int from public.announcement_photos)) g;
set local role authenticated;
do $$
begin
  if pg_temp.code('00000000-0000-4000-8000-0000000002a1',
      'select public.add_announcement_photo(''https://images.quizmatter.com/uploads/one-more.webp'', 10, 10)') is distinct from '22023' then
    raise exception 'FAIL: a 501st photo was listed';
  end if;
  if pg_temp.code('00000000-0000-4000-8000-0000000002a1',
      'select public.add_announcement_photo(''https://images.quizmatter.com/uploads/a.webp'', 800, 600)') is not null then
    raise exception 'FAIL: adding a photo already listed was refused at the limit';
  end if;
end;
$$;

rollback;
