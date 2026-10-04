-- A history of the click limits (20261013000000_click_limits.sql, 20261014000000_click_auto_ban.sql) for
-- Admin → Safety → History. click_rate keeps only each teacher's current state, so a pause was gone once a new one
-- replaced it. Now every pause and automatic ban is also written here, and so is an admin's Release / Reset count
-- (src/app/admin/safety/actions.ts). Rows are kept; the page shows the newest ones.

-- ─── 1. The history, one row per event ────────────────────────────────────────────────────────────────────
create table public.click_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null references public.click_limits (feature) on delete cascade,
  kind text not null check (kind in ('pause', 'ban', 'release')),
  -- How long the pause was (pause only).
  pause_minutes int,
  -- Pauses in the chain at that moment, e.g. 2 of 3 (pause and ban only).
  streak int,
  created_at timestamptz not null default now()
);

create index click_history_created_at on public.click_history (created_at desc);

-- Nobody reads or changes it through the API (no policies): count_click writes it, the admin page uses the secret key.
alter table public.click_history enable row level security;

-- ─── 2. count_click: also writes the pause or ban to the history ──────────────────────────────────────────
-- Same as before (20261014000000_click_auto_ban.sql); only the two inserts into click_history and `minutes` are new.
-- If the click itself fails later (e.g. too many bookmarks), its history row is undone with it.
create or replace function public.count_click(feature text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  lim public.click_limits;
  last_pause timestamptz;
  last_streak int;
  streak int;
  user_clicks int;
  minutes int;
begin
  if auth.uid() is null or public.is_admin() then
    return;
  end if;
  select * into lim from public.click_limits l where l.feature = count_click.feature;
  if not found then
    raise exception 'Unknown feature.' using errcode = '22023';
  end if;

  -- "for update": two clicks at the same moment wait for each other, so both are counted.
  select r.paused_until, r.pause_streak into last_pause, last_streak
  from public.click_rate r
  where r.user_id = auth.uid() and r.feature = count_click.feature
  for update;
  if last_pause > now() then
    raise exception 'Too many clicks. Try again later.'
      using errcode = 'QMBLK', detail = (extract(epoch from last_pause) * 1000)::bigint::text;
  end if;

  insert into public.click_rate as r (user_id, feature, window_start, clicks)
  values (auth.uid(), count_click.feature, now(), 1)
  on conflict (user_id, feature) do update set
    window_start = case when r.window_start < now() - make_interval(secs => lim.per_seconds) then now() else r.window_start end,
    clicks = case when r.window_start < now() - make_interval(secs => lim.per_seconds) then 1 else r.clicks + 1 end
  returning clicks into user_clicks;

  if user_clicks < lim.max_clicks then
    return;
  end if;

  -- This click reached the limit. It still goes through, so the pause (or ban) is saved with it.
  streak := case
    when last_pause > now() - make_interval(hours => lim.repeat_within_hours) then coalesce(last_streak, 0) + 1
    else 1
  end;

  if streak >= lim.ban_after_pauses then
    insert into public.banned_users (user_id, reason, is_automatic)
    values (
      auth.uid(),
      format('Automatic ban: clicked %s too fast %s times, each within %s hours of the last.',
        lim.label, streak, lim.repeat_within_hours),
      true
    )
    on conflict (user_id) do nothing;
    -- Supabase's own ban, like an admin ban (banTeacher): 100 years, so until an admin unbans. Their login stops
    -- working within the hour.
    update auth.users set banned_until = now() + interval '876000 hours' where id = auth.uid();
    -- After an Unban they start from nothing, not one burst away from the next ban.
    update public.click_rate r set clicks = 0, window_start = now(), paused_until = null, pause_streak = 0
    where r.user_id = auth.uid();
    insert into public.click_history (user_id, feature, kind, streak)
    values (auth.uid(), count_click.feature, 'ban', streak);
  else
    minutes := case when streak > 1 then lim.repeat_pause_minutes else lim.first_pause_minutes end;
    update public.click_rate r set
      clicks = 0,
      window_start = now(),
      pause_streak = streak,
      paused_until = now() + make_interval(mins => minutes)
    where r.user_id = auth.uid() and r.feature = count_click.feature;
    insert into public.click_history (user_id, feature, kind, pause_minutes, streak)
    values (auth.uid(), count_click.feature, 'pause', minutes, streak);
  end if;
end;
$$;
