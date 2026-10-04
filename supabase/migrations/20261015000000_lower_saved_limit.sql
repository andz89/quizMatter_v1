-- At most 50 saved (bookmarked) presentations per teacher (was 500). Same as MAX_SAVED in src/lib/schema.ts.
-- Nobody had more than 50 when this was made. Same as before (20261013000000_click_limits.sql); only the number
-- is new.
create or replace function public.check_saved_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.count_click('saved');
  perform public.count_write('saved');
  -- Two saves from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext('saved:' || new.user_id::text));
  -- Same as MAX_SAVED in src/lib/schema.ts.
  if (select count(*) from public.saved_presentations s where s.user_id = new.user_id) >= 50 then
    raise exception 'You have 50 saved presentations, the most allowed.' using errcode = 'QMSAV';
  end if;
  return new;
end;
$$;
