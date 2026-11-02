-- The part an announcement doesn't show is kept empty (supabase/migrations/20261231000200_announcement_unused_part.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_unused_part.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- s1 super admin.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000004c1', 'unused-part-super@example.com', '{"first_name": "Unused", "last_name": "Super"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000004c1', true);

-- An announcement that is off, with a photo in every part; `extra` replaces some keys.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Unused part', 'is_on', false, 'starts_at', null, 'ends_at', null,
    'show_modal', true, 'modal_format', 'html', 'modal_height', 400, 'modal_close_after', 0,
    'modal_text', 'Leftover text',
    'modal_attachment', jsonb_build_object('kind', 'photo', 'src', 'https://images.quizmatter.com/uploads/unused-post.webp'),
    'modal_html', '<img src="https://images.quizmatter.com/uploads/unused-modal.webp">',
    'show_bar', false, 'bar_format', 'html', 'bar_height', 60, 'bar_close_after', 0,
    'bar_html', '<img src="https://images.quizmatter.com/uploads/unused-bar.webp">',
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
  s1 constant uuid := '00000000-0000-4000-8000-0000000004c1';
  ours constant text := 'https://images.quizmatter.com/uploads/';
  saved uuid;
  r record;
begin
  -- 1. A modal: the bar's html is emptied; the modal keeps all of its fields (post and html).
  perform pg_temp.act_as(s1);
  saved := public.save_announcement(pg_temp.ann('{}'));
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = saved;
  if r.bar_html <> '' then
    raise exception 'FAIL: a modal kept its bar html: %', r.bar_html;
  end if;
  if r.modal_html not like '%unused-modal%' or r.modal_text <> 'Leftover text' or r.modal_attachment is null then
    raise exception 'FAIL: a modal lost its own fields';
  end if;

  -- 2. Changed to a top bar: the modal's text, attachment and html are emptied; the bar keeps its html.
  perform pg_temp.act_as(s1);
  perform public.save_announcement(pg_temp.ann(jsonb_build_object(
    'id', saved, 'show_modal', false, 'show_bar', true,
    'bar_html', '<img src="https://images.quizmatter.com/uploads/unused-bar.webp">')));
  perform pg_temp.act_as(s1);
  select * into r from public.admin_announcements() a where a.id = saved;
  if r.modal_text <> '' or r.modal_attachment is not null or r.modal_html <> '' then
    raise exception 'FAIL: a top bar kept its modal: % / % / %', r.modal_text, r.modal_attachment, r.modal_html;
  end if;
  if r.bar_html not like '%unused-bar%' then
    raise exception 'FAIL: a top bar lost its own html';
  end if;

  -- 3. A photo only in the emptied modal isn't used: it can be taken off the Photos tab.
  perform pg_temp.act_as(s1);
  perform public.add_announcement_photo(ours || 'unused-modal.webp', 100, 100);
  perform pg_temp.act_as(s1);
  perform public.delete_announcement_photo(ours || 'unused-modal.webp');
end;
$$;

-- 4. A direct write (the table, not save_announcement) is emptied the same way.
reset role;
do $$
declare
  r public.announcements;
begin
  update public.announcements set modal_text = 'Sneaked in', modal_html = '<p>x</p>' where name = 'Unused part'
  returning * into r;
  if r.modal_text <> '' or r.modal_html <> '' then
    raise exception 'FAIL: a direct write kept the modal of a top bar';
  end if;
  if 'https://images.quizmatter.com/uploads/unused-post.webp' = any (public.used_photo_srcs()) then
    raise exception 'FAIL: used_photo_srcs keeps a photo of an emptied modal';
  end if;
end;
$$;

rollback;
