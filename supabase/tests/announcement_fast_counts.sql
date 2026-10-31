-- The fast count (one query over every account) always agrees with the rule each teacher is checked by
-- (supabase/migrations/20261224000000_announcement_fast_counts.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_fast_counts.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- s1 super admin (empty details), t1 teacher with every detail (3 own presentations + 1 shared copy), t2 teacher
-- with every detail empty, e1 editor (male, Bohol, 1 presentation), b1 banned teacher with t1's details.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000b1', 'fast-super@example.com', '{"first_name": "Fast", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000b2', 'fast-t1@example.com', '{"first_name": "Fast", "last_name": "One"}'),
  ('00000000-0000-4000-8000-0000000000b3', 'fast-t2@example.com', '{"first_name": "Fast", "last_name": "Empty"}'),
  ('00000000-0000-4000-8000-0000000000b4', 'fast-e1@example.com', '{"first_name": "Fast", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000b5', 'fast-b1@example.com', '{"first_name": "Fast", "last_name": "Banned"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000b1', true);
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000b4');
insert into public.banned_users (user_id, reason) values ('00000000-0000-4000-8000-0000000000b5', 'Test ban');

update public.user_settings set
  birth_date = (public.manila_today() - interval '36 years 6 months')::date,
  gender = 'female', province = 'Cebu', town = 'Mandaue City',
  education_level = 'master', education_field = 'Secondary Education, major in English'
where user_id in ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b5');
update public.user_settings set birth_date = null, gender = '', province = '', town = '', education_level = '',
  education_field = ''
where user_id in ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b3');
update public.user_settings set
  birth_date = (public.manila_today() - interval '52 years')::date,
  gender = 'male', province = 'Bohol', town = 'Tagbilaran City',
  education_level = 'doctorate', education_field = 'Mathematics'
where user_id = '00000000-0000-4000-8000-0000000000b4';

insert into public.presentations (id, owner_id, title) values
  ('test-fast-p1', '00000000-0000-4000-8000-0000000000b2', 'One'),
  ('test-fast-p2', '00000000-0000-4000-8000-0000000000b2', 'Two'),
  ('test-fast-p3', '00000000-0000-4000-8000-0000000000b2', 'Three'),
  ('test-fast-p4', '00000000-0000-4000-8000-0000000000b4', 'Four');
select set_config('quizmatter.sharing', 'yes', true);
insert into public.presentations (id, owner_id, title, shared_from, shared_at) values
  ('test-fast-c1', '00000000-0000-4000-8000-0000000000b2', 'One', 'test-fast-p1', now());
select set_config('quizmatter.sharing', '', true);

-- Filter sets: each filter alone, both ways, and a few together.
create temp table filter_sets (name text primary key, filters jsonb);
insert into filter_sets values
  ('none', '{}'),
  ('female', '{"genders": ["female"]}'),
  ('male', '{"genders": ["male"]}'),
  ('age 30-40', '{"age_min": 30, "age_max": 40}'),
  ('age 50+', '{"age_min": 50}'),
  ('age 18 (empty birthday fails)', '{"age_min": 18}'),
  ('Cebu', '{"provinces": ["Cebu"]}'),
  ('Bohol or Cebu', '{"provinces": ["Bohol", "Cebu"]}'),
  ('town mandaue', '{"town_words": ["MANDAUE"]}'),
  ('town a', '{"town_words": ["a"]}'),
  ('master', '{"education_levels": ["master"]}'),
  ('field english/math', '{"field_words": ["english", "math"]}'),
  ('3 presentations', '{"presentations_min": 3, "presentations_max": 3}'),
  ('0 presentations', '{"presentations_max": 0}'),
  ('1+ presentations', '{"presentations_min": 1}'),
  ('teachers', '{"roles": ["teacher"]}'),
  ('editors', '{"roles": ["editor"]}'),
  ('admins', '{"roles": ["admin"]}'),
  ('editors or admins', '{"roles": ["editor", "admin"]}'),
  ('female Cebu master 1+', '{"genders": ["female"], "provinces": ["Cebu"], "education_levels": ["master"], "presentations_min": 1}'),
  ('nobody', '{"genders": ["male"], "provinces": ["Cebu"]}');

-- What the per-teacher rule says (announcement_matches, as each teacher's own list checks it), counted one by one.
create temp table expected as
  select f.name, (
    select count(*) from public.user_settings s
    where public.announcement_matches(jsonb_populate_record(null::public.announcements, f.filters), s.user_id)
  )::int as n
  from filter_sets f;

create temp table got (name text, n int);
grant select on filter_sets to authenticated;
grant all on got to authenticated;

-- ─── The fast count, as the super admin ──────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}', true);
set local role authenticated;
insert into got select f.name, public.announcement_audience(f.filters) from filter_sets f;
reset role;

do $$
declare
  r record;
begin
  for r in select e.name, e.n as want, g.n as got from expected e join got g using (name) loop
    if r.want <> r.got then
      raise exception 'FAIL: "%": the fast count gave %, the per-teacher rule %', r.name, r.got, r.want;
    end if;
  end loop;
  -- The rule itself, on a few sets: the banned teacher never counts, empty details never match a filter on them.
  if (select n from expected where name = 'Cebu') <> 1 then
    raise exception 'FAIL: "Cebu" should match t1 only (banned b1 left out), got %', (select n from expected where name = 'Cebu');
  end if;
  if (select n from expected where name = 'female Cebu master 1+') <> 1 or (select n from expected where name = 'nobody') <> 0 then
    raise exception 'FAIL: the combined filters are wrong';
  end if;
end;
$$;

rollback;
