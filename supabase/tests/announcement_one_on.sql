-- One modal and one top bar on at a time (supabase/migrations/20261228000000_announcement_one_on.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_one_on.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000001a1', 'one-on-super@example.com', '{"first_name": "One", "last_name": "Super"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000001a1', true);

-- A modal that is on; `extra` replaces some keys.
create function pg_temp.ann(extra jsonb) returns jsonb language sql as $$
  select '{
    "name": "Modal", "is_on": true, "starts_at": null, "ends_at": null,
    "show_modal": true, "modal_text": "Hello", "modal_close_after": 0,
    "show_bar": false, "bar_html": "", "bar_close_after": 0,
    "repeat": "once", "pages": ["all"],
    "genders": [], "age_min": null, "age_max": null,
    "education_levels": [], "field_words": [], "presentations_min": null, "presentations_max": null, "roles": []
  }'::jsonb || extra;
$$;

-- The same, as a top bar.
create function pg_temp.bar(extra jsonb) returns jsonb language sql as $$
  select pg_temp.ann('{"name": "Bar", "show_modal": false, "modal_text": "", "show_bar": true, "bar_html": "<p>Bar</p>"}'::jsonb || extra);
$$;

-- Each step as the super admin, as its own app request (the Admin log writes one row per request).
create function pg_temp.as_super() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000001a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('quizmatter.admin_logged', '', true);
end;
$$;

create function pg_temp.save(a jsonb, replace_current boolean default false) returns uuid language plpgsql as $$
begin
  perform pg_temp.as_super();
  return public.save_announcement(a, replace_current);
end;
$$;

-- The error code a step raised, or null when it worked.
create function pg_temp.code(step text) returns text language plpgsql as $$
begin
  perform pg_temp.as_super();
  execute step;
  return null;
exception when others then
  return sqlstate;
end;
$$;

-- Read the table as postgres (teachers and admins read it only through the functions).
create function pg_temp.is_on(target uuid) returns boolean language sql security definer as $$
  select is_on from public.announcements where id = target;
$$;
create function pg_temp.saved(saved_name text) returns boolean language sql security definer as $$
  select exists (select 1 from public.announcements where name = saved_name);
$$;

grant execute on all functions in schema pg_temp to authenticated;
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;

-- ─── 1. A second modal is refused; a draft saves; a bar can be on next to the modal ──────────────────────────
do $$
declare
  first_modal uuid;
  draft uuid;
  first_bar uuid;
begin
  first_modal := pg_temp.save(pg_temp.ann('{"name": "First modal"}'));
  insert into ids values ('first_modal', first_modal);

  if pg_temp.code('select public.save_announcement(pg_temp.ann(''{"name": "Second modal"}''))') is distinct from 'QMONE' then
    raise exception 'FAIL: a second modal that is on was not refused with QMONE';
  end if;
  if pg_temp.saved('Second modal') then
    raise exception 'FAIL: the refused modal was saved anyway';
  end if;

  -- Saving the one that is on again is not a conflict.
  perform pg_temp.save(pg_temp.ann('{"name": "First modal", "modal_text": "Changed"}') || jsonb_build_object('id', first_modal));

  draft := pg_temp.save(pg_temp.ann('{"name": "Draft modal", "is_on": false}'));
  insert into ids values ('draft', draft);
  if pg_temp.is_on(draft) then
    raise exception 'FAIL: the draft is on';
  end if;

  first_bar := pg_temp.save(pg_temp.bar('{"name": "First bar"}'));
  insert into ids values ('first_bar', first_bar);
  if not pg_temp.is_on(first_modal) or not pg_temp.is_on(first_bar) then
    raise exception 'FAIL: a modal and a bar could not be on together';
  end if;

  if pg_temp.code('select public.save_announcement(pg_temp.bar(''{"name": "Second bar"}''))') is distinct from 'QMONE' then
    raise exception 'FAIL: a second bar that is on was not refused with QMONE';
  end if;
end;
$$;

-- ─── 2. The refusal's message is the name of the one that is on ─────────────────────────────────────────────
do $$
begin
  perform pg_temp.as_super();
  perform public.save_announcement(pg_temp.ann('{"name": "Second modal"}'));
  raise exception 'FAIL: not refused';
exception when sqlstate 'QMONE' then
  if sqlerrm <> 'First modal' then
    raise exception 'FAIL: the refusal says "%", not the name of the one that is on', sqlerrm;
  end if;
end;
$$;

-- ─── 3. Replace: the old one goes off, the new one on, and the Admin log names the old one ──────────────────
do $$
declare
  first_modal uuid := (select id from ids where name = 'first_modal');
  second_modal uuid;
begin
  second_modal := pg_temp.save(pg_temp.ann('{"name": "Second modal"}'), true);
  insert into ids values ('second_modal', second_modal);
  if pg_temp.is_on(first_modal) or not pg_temp.is_on(second_modal) then
    raise exception 'FAIL: replace did not turn the old modal off and the new one on';
  end if;
  if not pg_temp.is_on((select id from ids where name = 'first_bar')) then
    raise exception 'FAIL: replacing a modal turned the bar off';
  end if;
end;
$$;

reset role;
do $$
begin
  if not exists (select 1 from public.admin_actions where action = 'announcement_saved'
      and target_title = 'Second modal' and details ->> 'turned_off' = 'First modal') then
    raise exception 'FAIL: the Admin log does not name the modal that was turned off';
  end if;
end;
$$;
set local role authenticated;

-- ─── 4. set_announcement_on: refused, then replace ──────────────────────────────────────────────────────────
do $$
declare
  draft uuid := (select id from ids where name = 'draft');
  second_modal uuid := (select id from ids where name = 'second_modal');
begin
  if pg_temp.code(format('select public.set_announcement_on(%L, true)', draft)) is distinct from 'QMONE' then
    raise exception 'FAIL: set_announcement_on turned on a second modal';
  end if;
  if pg_temp.is_on(draft) then
    raise exception 'FAIL: the refused draft is on';
  end if;

  perform pg_temp.as_super();
  perform public.set_announcement_on(draft, true, true);
  if pg_temp.is_on(second_modal) or not pg_temp.is_on(draft) then
    raise exception 'FAIL: set_announcement_on with replace did not swap them';
  end if;

  -- Turning off is never a conflict.
  perform pg_temp.as_super();
  perform public.set_announcement_on(draft, false);
end;
$$;

-- ─── 5. A scheduled one counts; an ended one doesn't ────────────────────────────────────────────────────────
do $$
declare
  scheduled uuid;
begin
  scheduled := pg_temp.save(pg_temp.ann('{"name": "Next week"}') || jsonb_build_object('starts_at', now() + interval '7 days'));
  if pg_temp.code('select public.save_announcement(pg_temp.ann(''{"name": "Another"}''))') is distinct from 'QMONE' then
    raise exception 'FAIL: a scheduled modal did not count as on';
  end if;
  perform pg_temp.save(pg_temp.ann('{"name": "Next week", "is_on": false}') || jsonb_build_object('id', scheduled));

  perform pg_temp.save(pg_temp.ann('{"name": "Old one"}') || jsonb_build_object('ends_at', now() - interval '1 hour'));
  perform pg_temp.save(pg_temp.ann('{"name": "Fresh"}'));
end;
$$;

-- ─── 6. Both types in one announcement are refused ──────────────────────────────────────────────────────────
do $$
begin
  if pg_temp.code('select public.save_announcement(pg_temp.ann(''{"is_on": false, "show_bar": true, "bar_html": "<p>Bar</p>"}''))')
    is distinct from '22023' then
    raise exception 'FAIL: an announcement with both a modal and a bar was saved';
  end if;
end;
$$;

rollback;
