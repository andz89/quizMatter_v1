-- The announcement modal as a post: plain text + one attachment (a picture, or a YouTube card)
-- (supabase/migrations/20261225000000_announcement_post.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_post.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): s1 super admin, t1 teacher ──────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'post-super@example.com', '{"first_name": "Post", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'post-t1@example.com', '{"first_name": "Post", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000a1', true);

create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select '{
    "name": "Post test", "is_on": true, "starts_at": null, "ends_at": null,
    "show_modal": true, "modal_text": "Hello", "modal_attachment": null, "modal_close_after": 0,
    "show_bar": false, "bar_html": "", "bar_close_after": 0,
    "repeat": "once", "pages": ["all"], "modal_size": "large",
    "genders": [], "age_min": null, "age_max": null, "provinces": [], "town_words": [],
    "education_levels": [], "field_words": [], "presentations_min": null, "presentations_max": null, "roles": []
  }'::jsonb || extra;
$$;

create function pg_temp.save(a jsonb) returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform set_config('quizmatter.admin_logged', '', true);
  return public.save_announcement(a);
end;
$$;

-- True when saving it is refused (any error).
create function pg_temp.refused(a jsonb) returns boolean language plpgsql as $$
begin
  perform pg_temp.save(a);
  return false;
exception when others then
  return true;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, service_role;
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, service_role;
set local role authenticated;

-- ─── 1. A YouTube card is saved and teachers get the text and the card ───────────────────────────────────────
do $$
declare
  card constant jsonb := '{"kind": "youtube", "video_id": "dQw4w9WgXcQ", "title": "A song",
    "src": "https://images.quizmatter.com/uploads/thumb.jpg", "width": 1280, "height": 720}';
  saved uuid;
  r record;
begin
  saved := pg_temp.save(pg_temp.ann(jsonb_build_object('modal_text', E'Line one\nLine two', 'modal_attachment', card)));
  insert into ids values ('card', saved);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true);
  select * into r from public.my_announcements() m where m.id = saved;
  if r.modal_text is distinct from E'Line one\nLine two' or r.modal_attachment is distinct from card then
    raise exception 'FAIL: my_announcements gave text % and attachment %', r.modal_text, r.modal_attachment;
  end if;
end;
$$;

-- ─── 2. What a modal may hold ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  ours constant text := 'https://images.quizmatter.com/uploads/';
begin
  -- Allowed: text only, a picture only (no text), a picture without its size (converted old rows).
  if pg_temp.refused(pg_temp.ann('{"modal_text": "Just text"}'))
    or pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_text', '', 'modal_attachment',
      jsonb_build_object('kind', 'photo', 'src', ours || 'a.webp', 'width', 800, 'height', 600))))
    or pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_attachment',
      jsonb_build_object('kind', 'photo', 'src', ours || 'a.webp')))) then
    raise exception 'FAIL: a valid modal was refused';
  end if;

  -- Refused.
  if not pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_text', repeat('a', 5001)))) then
    raise exception 'FAIL: 5,001 characters of text were saved';
  end if;
  if not pg_temp.refused(pg_temp.ann('{"modal_text": "  ", "modal_attachment": null}')) then
    raise exception 'FAIL: a shown modal with no text and no attachment was saved';
  end if;
  if not pg_temp.refused(pg_temp.ann('{"modal_attachment": {"kind": "photo", "src": "https://evil.example/a.png"}}')) then
    raise exception 'FAIL: a picture from another site was saved';
  end if;
  if not pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_attachment', jsonb_build_object('kind', 'youtube',
      'video_id', 'bad id', 'title', 'x', 'src', ours || 't.jpg', 'width', 1280, 'height', 720)))) then
    raise exception 'FAIL: a bad video id was saved';
  end if;
  if not pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_attachment', jsonb_build_object('kind', 'youtube',
      'video_id', 'dQw4w9WgXcQ', 'title', repeat('t', 201), 'src', ours || 't.jpg', 'width', 1280, 'height', 720)))) then
    raise exception 'FAIL: a 201-character title was saved';
  end if;
  if not pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_attachment', jsonb_build_object('kind', 'youtube',
      'video_id', 'dQw4w9WgXcQ', 'title', 'x', 'src', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')))) then
    raise exception 'FAIL: a thumbnail from YouTube itself (not our copy) was saved';
  end if;
  if not pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_attachment',
      jsonb_build_object('kind', 'iframe', 'src', ours || 'a.webp')))) then
    raise exception 'FAIL: an unknown kind of attachment was saved';
  end if;
  if not pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_attachment',
      jsonb_build_object('kind', 'photo', 'src', ours || 'a.webp', 'width', 0, 'height', 600)))) then
    raise exception 'FAIL: a picture 0 wide was saved';
  end if;
  if not pg_temp.refused(pg_temp.ann(jsonb_build_object('modal_attachment',
      jsonb_build_object('kind', 'photo', 'src', ours || 'a.webp', 'onerror', 'alert(1)')))) then
    raise exception 'FAIL: an attachment with an extra key was saved';
  end if;
end;
$$;

-- ─── 3. The photo cleanup keeps an attachment's picture (a YouTube thumbnail too) ────────────────────────────
reset role;
set local role service_role;
do $$
begin
  if not 'https://images.quizmatter.com/uploads/thumb.jpg' = any (public.used_photo_srcs()) then
    raise exception 'FAIL: used_photo_srcs does not keep the YouTube thumbnail';
  end if;
end;
$$;
reset role;

-- ─── 4. Old rich text becomes a post (what the migration did to existing announcements) ──────────────────────
do $$
declare
  old_html constant text := '<p>Hello &amp; welcome</p><p></p><p>Line <strong>two</strong><br>three &lt;3</p>'
    || '<p><img src="https://images.quizmatter.com/uploads/a.webp" width="300" height="200"></p>'
    || '<p><img src="https://images.quizmatter.com/uploads/b.webp"></p>';
begin
  if public.announcement_text_from_html(old_html) is distinct from E'Hello & welcome\n\nLine two\nthree <3' then
    raise exception 'FAIL: the old text became %', public.announcement_text_from_html(old_html);
  end if;
  if public.announcement_attachment_from_html(old_html) is distinct from
      '{"kind": "photo", "src": "https://images.quizmatter.com/uploads/a.webp", "width": 300, "height": 200}'::jsonb then
    raise exception 'FAIL: the old first picture became %', public.announcement_attachment_from_html(old_html);
  end if;
  if public.announcement_attachment_from_html('<p><img src="https://evil.example/x.png"></p>') is not null then
    raise exception 'FAIL: a picture from another site became an attachment';
  end if;
  if public.announcement_attachment_from_html('<p>No picture</p>') is not null then
    raise exception 'FAIL: text without a picture got an attachment';
  end if;
end;
$$;

rollback;
