-- Fixes for saving (bookmarking) presentations (20261010000000_saved_presentations.sql):
-- 1. Two saves at the same moment could both see 499 saved and both go in, past the 500 limit. They now wait
--    for each other, like new presentations do (check_presentation_limit).
-- 2. Saving and removing now count toward the speed limit (count_write: 30 a minute, QM429), like every other
--    write, so a script can't save and remove in a loop.

-- ─── 1. count_write also counts 'saved' ────────────────────────────────────────────────────────────────────
-- Same as before (20261009000000_banned_users.sql); only 'saved' is new.
create or replace function public.count_write(kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  user_writes int;
begin
  if count_write.kind not in ('presentations', 'photos', 'saved') then
    raise exception 'Unknown kind of write.' using errcode = '22023';
  end if;
  if auth.uid() is null or public.is_admin() then
    return;
  end if;
  if exists (select 1 from public.banned_users where user_id = auth.uid()) then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;

  insert into public.write_rate as w (user_id, kind, window_start, writes)
  values (auth.uid(), count_write.kind, now(), 1)
  on conflict (user_id, kind) do update set
    window_start = case when w.window_start < now() - interval '1 minute' then now() else w.window_start end,
    writes = case when w.window_start < now() - interval '1 minute' then 1 else w.writes + 1 end
  returning w.writes into user_writes;

  if user_writes > 30 then
    raise exception 'Too many saves. Wait a minute and try again.' using errcode = 'QM429';
  end if;
end;
$$;

-- ─── 2. Saving: speed limit, then the 500 limit with a lock ────────────────────────────────────────────────
-- count_write also refuses banned teachers (QMBAN), so that check moved there.
create or replace function public.check_saved_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.count_write('saved');
  -- Two saves from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext('saved:' || new.user_id::text));
  -- Same as MAX_SAVED in src/lib/schema.ts.
  if (select count(*) from public.saved_presentations s where s.user_id = new.user_id) >= 500 then
    raise exception 'You have 500 saved presentations, the most allowed.' using errcode = 'QMSAV';
  end if;
  return new;
end;
$$;

-- ─── 3. Removing: speed limit ──────────────────────────────────────────────────────────────────────────────
-- Only when teachers remove their own saved row. Rows removed because the presentation was deleted aren't
-- counted against the person deleting it.
create function public.count_saved_removal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.user_id = (select auth.uid()) then
    perform public.count_write('saved');
  end if;
  return old;
end;
$$;

create trigger saved_removal_rate
  before delete on public.saved_presentations
  for each row execute function public.count_saved_removal();
