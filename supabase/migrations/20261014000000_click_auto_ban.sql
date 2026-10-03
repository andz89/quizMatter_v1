-- Automatic ban for teachers who keep clicking a feature too fast (20261013000000_click_limits.sql).
-- Pauses form a chain: a pause within `repeat_within_hours` of the last one ended adds to it, a later one starts
-- it again. When the chain reaches the feature's `ban_after_pauses` (bookmarks: 3), the teacher is banned instead
-- of paused, like an admin ban on Admin → Teachers: a banned_users row (marked automatic, with the reason written
-- for them) and Supabase's own login ban. An admin lifts it with Unban, as usual.

-- ─── 1. New columns ───────────────────────────────────────────────────────────────────────────────────────
-- What the ban reason calls the feature, and how long a chain of pauses bans (null = never bans).
alter table public.click_limits
  add column label text not null default '' check (length(label) <= 60),
  add column ban_after_pauses int check (ban_after_pauses > 1);

update public.click_limits set label = 'Save (bookmarks)', ban_after_pauses = 3 where feature = 'saved';

-- How many pauses in a row the current chain has.
alter table public.click_rate add column pause_streak int not null default 0;

-- Banned by count_click (true) or by an admin (false). Admin → Teachers shows "Automatic".
alter table public.banned_users add column is_automatic boolean not null default false;

-- ─── 2. count_click: pause, or ban at the end of the chain ────────────────────────────────────────────────
-- Same as before (20261013000000_click_limits.sql), with the chain and the ban added when the limit is reached.
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
  else
    update public.click_rate r set
      clicks = 0,
      window_start = now(),
      pause_streak = streak,
      paused_until = now() + make_interval(mins => case when streak > 1 then lim.repeat_pause_minutes else lim.first_pause_minutes end)
    where r.user_id = auth.uid() and r.feature = count_click.feature;
  end if;
end;
$$;
