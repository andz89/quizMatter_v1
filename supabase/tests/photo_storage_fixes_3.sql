-- Photo storage review fixes, round 5 (supabase/migrations/20261231003000_photo_storage_fixes_3.sql): removing a
-- photo just uploaded frees its space at once, a slide save remembers only the photos that really leave the slide,
-- and the "freed" list is written once per statement (not once per row).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/photo_storage_fixes_3.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000007b1', 'psf3-teacher@example.com', '{"first_name": "Psf", "last_name": "Three"}');

create function pg_temp.f(x text) returns text language sql as $$
  select 'https://images.quizmatter.com/uploads/' || repeat(x, 64) || '.webp';
$$;
create function pg_temp.slide_with(id text, srcs text[]) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'type', 'blank', 'elements', coalesce(
    (select jsonb_agg(jsonb_build_object('id', 'e' || n, 'src', s)) from unnest(srcs) with ordinality as t(s, n)),
    '[]'::jsonb));
$$;

-- ─── Removing a photo just uploaded frees its space at once ──────────────────────────────────────────────────
-- The upload route: reserve (held 10 minutes), then the My photos row.
select public.reserve_photo_upload('00000000-0000-4000-8000-0000000007b1', pg_temp.f('a'), 1000000);
insert into public.photos (user_id, src, width, height)
values ('00000000-0000-4000-8000-0000000007b1', pg_temp.f('a'), 10, 10);
-- Another fresh upload that stays in My photos: it keeps counting.
select public.reserve_photo_upload('00000000-0000-4000-8000-0000000007b1', pg_temp.f('c'), 2000);
insert into public.photos (user_id, src, width, height)
values ('00000000-0000-4000-8000-0000000007b1', pg_temp.f('c'), 10, 10);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000007b1", "role": "authenticated"}', true);
do $$
declare
  answer jsonb := public.remove_my_photo(pg_temp.f('a'), 'if_unused');
begin
  if not (answer ->> 'removed')::boolean then
    raise exception 'FAIL: the unused photo wasn''t removed: %', answer;
  end if;
  if (answer ->> 'used')::bigint <> 2000 then
    raise exception 'FAIL: a photo just uploaded and removed still counts (used %)', answer ->> 'used';
  end if;
end;
$$;
reset role;

do $$
begin
  if public.photo_upload_counts('00000000-0000-4000-8000-0000000007b1', pg_temp.f('a')) then
    raise exception 'FAIL: the removed photo still counts';
  end if;
  if not public.photo_upload_counts('00000000-0000-4000-8000-0000000007b1', pg_temp.f('c')) then
    raise exception 'FAIL: the other fresh upload stopped counting';
  end if;
  -- The record stays (it's the teacher's upload): only its hold ended.
  if not exists (select 1 from public.photo_uploads
                 where user_id = '00000000-0000-4000-8000-0000000007b1' and src = pg_temp.f('a')) then
    raise exception 'FAIL: the upload record was deleted';
  end if;
end;
$$;

-- ─── A slide save remembers only the photos that leave the slide ─────────────────────────────────────────────
insert into public.photo_uploads (user_id, src, bytes, created_at) values
  ('00000000-0000-4000-8000-0000000007b1', pg_temp.f('d'), 1000, now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000007b1', pg_temp.f('e'), 1000, now() - interval '1 hour');
insert into public.presentations (id, owner_id, title)
values ('test-psf3-p1', '00000000-0000-4000-8000-0000000007b1', 'Freed Quiz');
insert into public.slides (presentation_id, id, position, data)
values ('test-psf3-p1', 's1', 0, pg_temp.slide_with('s1', array[pg_temp.f('d'), pg_temp.f('e')]));

-- e ("y") comes off s1, d ("x") stays.
update public.slides set data = pg_temp.slide_with('s1', array[pg_temp.f('d')])
where presentation_id = 'test-psf3-p1' and id = 's1';

do $$
begin
  if not public.slide_photo_freed('00000000-0000-4000-8000-0000000007b1', pg_temp.f('e')) then
    raise exception 'FAIL: y left the slide but isn''t remembered';
  end if;
  if public.slide_photo_freed('00000000-0000-4000-8000-0000000007b1', pg_temp.f('d')) then
    raise exception 'FAIL: x stayed on the slide but was remembered as freed';
  end if;
  if (select count(*) from public.slide_photos where presentation_id = 'test-psf3-p1' and slide_id = 's1') <> 1 then
    raise exception 'FAIL: s1 should keep only x';
  end if;
end;
$$;

-- ─── Many rows deleted at once: the list is written once per statement ──────────────────────────────────────
-- 2,000 of the owner's uploads on one slide, all taken off in one statement.
insert into public.photo_uploads (user_id, src, bytes, created_at)
select '00000000-0000-4000-8000-0000000007b1', 'https://images.quizmatter.com/uploads/' || md5('psf3' || i) || md5(i::text) || '.webp',
  10, now() - interval '1 hour'
from generate_series(1, 2000) i;
insert into public.slide_photos (presentation_id, slide_id, src)
select 'test-psf3-p1', 's1', 'https://images.quizmatter.com/uploads/' || md5('psf3' || i) || md5(i::text) || '.webp'
from generate_series(1, 2000) i;

do $$
declare
  started timestamptz := clock_timestamp();
  took interval;
begin
  delete from public.slide_photos where presentation_id = 'test-psf3-p1' and slide_id = 's1' and src <> pg_temp.f('d');
  took := clock_timestamp() - started;
  if not public.slide_photo_freed('00000000-0000-4000-8000-0000000007b1',
    'https://images.quizmatter.com/uploads/' || md5('psf3' || 1500) || md5('1500') || '.webp') then
    raise exception 'FAIL: a photo deleted in the big statement isn''t remembered';
  end if;
  if jsonb_array_length(current_setting('qm.freed_slide_photos')::jsonb) <> 2001 then
    raise exception 'FAIL: the freed list should hold y and the 2,000 photos once each (has %)',
      jsonb_array_length(current_setting('qm.freed_slide_photos')::jsonb);
  end if;
  -- Row by row this took seconds; once per statement it's a few milliseconds.
  if took > interval '1 second' then
    raise exception 'FAIL: deleting 2,000 slide photos took %', took;
  end if;
end;
$$;

rollback;
