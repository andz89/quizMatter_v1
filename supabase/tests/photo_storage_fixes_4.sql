-- Photo storage review fixes, round 6 (supabase/migrations/20261231003100_photo_storage_fixes_4.sql): a slide save
-- still makes every photo on a live QuizMatter slide public, a release still finds its record after remove_my_photo
-- ended the hold, and deleting many slides at once (the cascade, one statement per slide) stays fast.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/photo_storage_fixes_4.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000007c1', 'psf4-teacher@example.com', '{"first_name": "Psf", "last_name": "Four"}');

create function pg_temp.f(x text) returns text language sql as $$
  select 'https://images.quizmatter.com/uploads/' || repeat(x, 64) || '.webp';
$$;
create function pg_temp.slide_with(id text, srcs text[]) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'type', 'blank', 'elements', coalesce(
    (select jsonb_agg(jsonb_build_object('id', 'e' || n, 'src', s)) from unnest(srcs) with ordinality as t(s, n)),
    '[]'::jsonb));
$$;

-- ─── A slide save makes every photo on a live QuizMatter slide public ───────────────────────────────────────
-- A live lesson's slide has photo a; a's shared photo is waiting (not public), e.g. an editor uploaded that file
-- after it was already on the lesson. The slide then gets photo b: a goes public too, as before round 5.
insert into public.presentations (id, owner_id, title, from_admin, is_published)
values ('test-psf4-live', '00000000-0000-4000-8000-0000000007c1', 'Live Lesson', true, true);
insert into public.slides (presentation_id, id, position, data)
values ('test-psf4-live', 's1', 0, pg_temp.slide_with('s1', array[pg_temp.f('a')]));
insert into public.photo_categories (id, name) values ('00000000-0000-4000-8000-0000000007cc', 'Psf4 Category')
on conflict do nothing;
insert into public.shared_photos (src, width, height, category_id, is_public)
values (pg_temp.f('a'), 10, 10, '00000000-0000-4000-8000-0000000007cc', false);

update public.slides set data = pg_temp.slide_with('s1', array[pg_temp.f('a'), pg_temp.f('b')])
where presentation_id = 'test-psf4-live' and id = 's1';

do $$
begin
  if not (select is_public from public.shared_photos where src = pg_temp.f('a')) then
    raise exception 'FAIL: a photo already on a live QuizMatter slide stayed waiting after the slide changed';
  end if;
end;
$$;

-- ─── A release still finds its record after remove_my_photo ended the hold ─────────────────────────────────
-- x is in My photos without an upload record (not theirs). Tab 1 uploads x (reserve: new record), tab 2 removes x
-- (ends the hold), then tab 1's My photos row is refused and it releases: the record it made is deleted.
insert into public.photos (user_id, src, width, height)
values ('00000000-0000-4000-8000-0000000007c1', pg_temp.f('d'), 10, 10);
create temp table reserved on commit drop as
select public.reserve_photo_upload('00000000-0000-4000-8000-0000000007c1', pg_temp.f('d'), 5000) as answer;
grant select on reserved to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000007c1", "role": "authenticated"}', true);
select public.remove_my_photo(pg_temp.f('d'), 'if_unused');
reset role;

do $$
declare
  a jsonb := (select answer from reserved);
begin
  if public.photo_upload_counts('00000000-0000-4000-8000-0000000007c1', pg_temp.f('d')) then
    raise exception 'FAIL: the removed photo still counts';
  end if;
  perform public.release_photo_upload('00000000-0000-4000-8000-0000000007c1', pg_temp.f('d'), a -> 'previous',
    (a ->> 'written_at')::timestamptz);
  if exists (select 1 from public.photo_uploads
             where user_id = '00000000-0000-4000-8000-0000000007c1' and src = pg_temp.f('d')) then
    raise exception 'FAIL: the refused upload''s record stayed after its release';
  end if;
end;
$$;

-- ─── Deleting 100 slides of 50 photos each in one save stays fast ──────────────────────────────────────────
-- The cascade deletes each slide's slide_photos in its own statement, so the freed list is written 100 times.
insert into public.presentations (id, owner_id, title)
values ('test-psf4-big', '00000000-0000-4000-8000-0000000007c1', 'Big Quiz');
insert into public.photo_uploads (user_id, src, bytes, created_at)
select '00000000-0000-4000-8000-0000000007c1', 'https://images.quizmatter.com/uploads/' || md5('psf4' || i) || md5(i::text) || '.webp',
  10, now() - interval '1 hour'
from generate_series(1, 5000) i;
insert into public.slides (presentation_id, id, position, data)
select 'test-psf4-big', 's' || n, n, jsonb_build_object('id', 's' || n, 'type', 'blank', 'elements', '[]'::jsonb)
from generate_series(1, 100) n;
insert into public.slide_photos (presentation_id, slide_id, src)
select 'test-psf4-big', 's' || (1 + (i - 1) / 50),
  'https://images.quizmatter.com/uploads/' || md5('psf4' || i) || md5(i::text) || '.webp'
from generate_series(1, 5000) i;

do $$
declare
  started timestamptz := clock_timestamp();
  took interval;
begin
  delete from public.slides where presentation_id = 'test-psf4-big';
  took := clock_timestamp() - started;
  if jsonb_array_length(current_setting('qm.freed_slide_photos')::jsonb) < 5000 then
    raise exception 'FAIL: the 5,000 photos weren''t all remembered';
  end if;
  if took > interval '2 seconds' then
    raise exception 'FAIL: deleting 100 slides of 50 photos took %', took;
  end if;
  raise notice 'deleting 100 slides of 50 photos took %', took;
end;
$$;

rollback;
