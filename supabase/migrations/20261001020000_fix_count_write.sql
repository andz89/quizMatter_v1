-- Fix: count_write's `kind` parameter has the same name as write_rate's `kind` column, so the database couldn't
-- tell them apart ("column reference kind is ambiguous") and every teacher's save failed. Admins skip the count,
-- so they weren't affected. The parameter keeps its name (the app calls it by name); inside the function,
-- plain `kind` now means the column, and the parameter is written count_write.kind.
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
  if count_write.kind not in ('presentations', 'photos') then
    raise exception 'Unknown kind of write.' using errcode = '22023';
  end if;
  if auth.uid() is null or public.is_admin() then
    return;
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
