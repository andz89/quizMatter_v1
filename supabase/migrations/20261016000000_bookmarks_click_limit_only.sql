-- Bookmarks (saved_presentations) only use their own click limit now (count_click('saved'): 20 clicks in 25
-- seconds pauses them, 3 pauses in a row ban), not the 30-a-minute save limit (count_write) too. Both watched the
-- same clicks, and the save limit won: a click it refused was rolled back with its click count, so the pause could
-- never start, and a fast clicker only got "You're saving too fast" again and again. Presentations and photos keep
-- count_write. count_write also refused banned teachers (QMBAN); bookmarks now check that themselves.
-- Same as before (20261015000000_lower_saved_limit.sql and 20261013000000_click_limits.sql) otherwise.

create or replace function public.check_saved_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  perform public.count_click('saved');
  -- Two saves from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext('saved:' || new.user_id::text));
  -- Same as MAX_SAVED in src/lib/schema.ts.
  if (select count(*) from public.saved_presentations s where s.user_id = new.user_id) >= 50 then
    raise exception 'You have 50 saved presentations, the most allowed.' using errcode = 'QMSAV';
  end if;
  return new;
end;
$$;

-- Only when teachers remove their own saved row. Rows removed because the presentation was deleted aren't
-- counted against the person deleting it.
create or replace function public.count_saved_removal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.user_id = (select auth.uid()) then
    if public.is_banned() then
      raise exception 'This account is banned.' using errcode = 'QMBAN';
    end if;
    perform public.count_click('saved');
  end if;
  return old;
end;
$$;
