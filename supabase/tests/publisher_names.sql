-- publisher_names: the "Publisher" line other teachers see never carries an email address; only admins get
-- "Display Name (email)" (supabase/migrations/20261231001200_publisher_names_no_email.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/publisher_names.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- e1 a teacher who published (display name "Pn Named"), e2 a teacher who published but has no display name,
-- e3 another teacher who looks, e4 an admin.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'pn-named@example.com', '{"first_name": "Pn", "last_name": "Named"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'pn-nameless@example.com', '{}'),
  ('00000000-0000-4000-8000-0000000000e3', 'pn-viewer@example.com', '{"first_name": "Pn", "last_name": "Viewer"}'),
  ('00000000-0000-4000-8000-0000000000e4', 'pn-admin@example.com', '{"first_name": "Pn", "last_name": "Admin"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000e4');
update public.user_settings set display_name = '' where user_id = '00000000-0000-4000-8000-0000000000e2';
insert into public.presentations (id, owner_id, title) values
  ('test-pn-1', '00000000-0000-4000-8000-0000000000e1', 'Named one'),
  ('test-pn-2', '00000000-0000-4000-8000-0000000000e2', 'Nameless one');
insert into public.slides (presentation_id, id, position, data)
select p.id, 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}'::jsonb
from public.presentations p where p.id in ('test-pn-1', 'test-pn-2');

do $$
begin
  if (select display_name from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000e1') <> 'Pn Named' then
    raise exception 'FAIL: setup: the teacher''s display name is not "Pn Named"';
  end if;
end;
$$;

-- ─── As each publisher: publish with the Share button ─────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
select public.share_presentation(target_id => 'test-pn-1');
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);
select public.share_presentation(target_id => 'test-pn-2');

-- ─── As another teacher: the name only, never an email ────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e3', 'role', 'authenticated')::text, true);

do $$
declare named text; leaked int;
begin
  select display_name into named from public.publisher_names(array[
    '00000000-0000-4000-8000-0000000000e1'::uuid, '00000000-0000-4000-8000-0000000000e2'::uuid])
  where user_id = '00000000-0000-4000-8000-0000000000e1';
  if named is distinct from 'Pn Named' then
    raise exception 'FAIL: a teacher sees "%" instead of "Pn Named"', named;
  end if;
  select count(*) into leaked from public.publisher_names(array[
    '00000000-0000-4000-8000-0000000000e1'::uuid, '00000000-0000-4000-8000-0000000000e2'::uuid])
  where display_name like '%@%';
  if leaked <> 0 then
    raise exception 'FAIL: a teacher sees % publisher email address(es)', leaked;
  end if;
end;
$$;

-- ─── As an admin: "Display Name (email)", or the email alone ──────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e4', 'role', 'authenticated')::text, true);

do $$
declare named text; nameless text;
begin
  select display_name into named from public.publisher_names(array['00000000-0000-4000-8000-0000000000e1'::uuid]);
  if named is distinct from 'Pn Named (pn-named@example.com)' then
    raise exception 'FAIL: an admin sees "%" instead of "Pn Named (pn-named@example.com)"', named;
  end if;
  select display_name into nameless from public.publisher_names(array['00000000-0000-4000-8000-0000000000e2'::uuid]);
  if nameless is distinct from 'pn-nameless@example.com' then
    raise exception 'FAIL: an admin sees "%" instead of the nameless publisher''s email', nameless;
  end if;
end;
$$;

rollback;
