-- A Facebook post or video as the modal's attachment (supabase/migrations/20261226000000_announcement_facebook.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_facebook.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000071', 'fb-super@example.com', '{"first_name": "Fb", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-000000000072', 'fb-t1@example.com', '{"first_name": "Fb", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-000000000071', true);

create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select '{
    "name": "Facebook test", "is_on": true, "starts_at": null, "ends_at": null,
    "show_modal": true, "modal_text": "", "modal_attachment": null, "modal_close_after": 0,
    "show_bar": false, "bar_html": "", "bar_close_after": 0,
    "repeat": "once", "pages": ["all"], "modal_size": "large",
    "genders": [], "age_min": null, "age_max": null, "provinces": [], "town_words": [],
    "education_levels": [], "field_words": [], "presentations_min": null, "presentations_max": null, "roles": []
  }'::jsonb || extra;
$$;

create function pg_temp.save(a jsonb) returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000071', 'role', 'authenticated')::text, true);
  perform set_config('quizmatter.admin_logged', '', true);
  return public.save_announcement(a);
end;
$$;

create function pg_temp.refused(attachment jsonb) returns boolean language plpgsql as $$
begin
  perform pg_temp.save(pg_temp.ann(jsonb_build_object('modal_attachment', attachment)));
  return false;
exception when others then
  return true;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, service_role;
set local role authenticated;

do $$
declare
  video constant jsonb := '{"kind": "facebook", "href": "https://www.facebook.com/watch/?v=123", "video": true}';
  saved uuid;
  r record;
begin
  -- 1. Accepted, and teachers get it back as it was saved.
  saved := pg_temp.save(pg_temp.ann(jsonb_build_object('modal_attachment', video)));
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000072', 'role', 'authenticated')::text, true);
  select * into r from public.my_announcements() m where m.id = saved;
  if r.modal_attachment is distinct from video then
    raise exception 'FAIL: my_announcements gave %', r.modal_attachment;
  end if;
  if pg_temp.refused('{"kind": "facebook", "href": "https://www.facebook.com/DepEd/posts/1", "video": false}')
    or pg_temp.refused('{"kind": "facebook", "href": "https://m.facebook.com/story.php?story_fbid=1&id=2", "video": false}')
    or pg_temp.refused('{"kind": "facebook", "href": "https://fb.watch/abcDEF123/", "video": true}') then
    raise exception 'FAIL: a valid Facebook link was refused';
  end if;

  -- 2. Refused.
  if not pg_temp.refused('{"kind": "facebook", "href": "https://evil.example/facebook.com/posts/1", "video": false}') then
    raise exception 'FAIL: a link to another site was saved';
  end if;
  if not pg_temp.refused('{"kind": "facebook", "href": "https://www.facebook.com.evil.example/posts/1", "video": false}') then
    raise exception 'FAIL: a look-alike site was saved';
  end if;
  if not pg_temp.refused('{"kind": "facebook", "href": "http://www.facebook.com/DepEd/posts/1", "video": false}') then
    raise exception 'FAIL: a link without https was saved';
  end if;
  if not pg_temp.refused('{"kind": "facebook", "href": "https://www.facebook.com/posts/1\"onload=\"x", "video": false}') then
    raise exception 'FAIL: a link with quotes was saved';
  end if;
  if not pg_temp.refused(jsonb_build_object('kind', 'facebook', 'href',
      'https://www.facebook.com/posts/' || repeat('x', 500), 'video', false)) then
    raise exception 'FAIL: a link over 500 characters was saved';
  end if;
  if not pg_temp.refused('{"kind": "facebook", "href": "https://www.facebook.com/DepEd/posts/1"}') then
    raise exception 'FAIL: a Facebook card without "video" was saved';
  end if;
  -- A missing key gives "unknown" in SQL, which a check lets through unless it's turned into "no".
  if not pg_temp.refused('{"kind": "youtube", "video_id": "dQw4w9WgXcQ", "src": "https://images.quizmatter.com/uploads/t.jpg"}') then
    raise exception 'FAIL: a YouTube card without a title was saved';
  end if;
  if not pg_temp.refused('{"kind": "photo"}') then
    raise exception 'FAIL: a photo without src was saved';
  end if;
  if not pg_temp.refused('{"src": "https://images.quizmatter.com/uploads/a.webp"}') then
    raise exception 'FAIL: an attachment without a kind was saved';
  end if;
  if not pg_temp.refused('{"kind": "facebook", "href": "https://www.facebook.com/DepEd/posts/1", "video": "yes"}') then
    raise exception 'FAIL: "video" that is not true or false was saved';
  end if;
  if not pg_temp.refused('{"kind": "facebook", "href": "https://www.facebook.com/DepEd/posts/1", "video": false, "src": "https://images.quizmatter.com/uploads/a.webp"}') then
    raise exception 'FAIL: a Facebook card with an extra key was saved';
  end if;
end;
$$;

-- 3. The photo cleanup: an attachment without a picture adds nothing (no empty entry).
reset role;
set local role service_role;
do $$
begin
  if array_position(public.used_photo_srcs(), null) is not null then
    raise exception 'FAIL: used_photo_srcs has an empty entry for a Facebook attachment';
  end if;
end;
$$;

rollback;
