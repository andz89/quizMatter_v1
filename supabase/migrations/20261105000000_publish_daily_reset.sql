-- The publishing limit (20261103000000_share_limits.sql) starts again at 12:00 midnight Philippine time, instead
-- of 24 hours after the teacher's first publish: "10 a day" is easier to understand. Reaching it pauses publishing
-- until that midnight (e.g. 10 publishes from 7:00 to 7:20 AM: paused until 12:00 AM).
--
-- The one click limit system (20261013000000_click_limits.sql) gets the option: a limit with daily_reset_time_zone
-- counts per day in that time zone, and its pause lasts until the next midnight there (first_pause_minutes,
-- repeat_pause_minutes and per_seconds aren't used for it). Empty = as before, counted from the first click.

alter table public.click_limits add column daily_reset_time_zone text;

update public.click_limits set daily_reset_time_zone = 'Asia/Manila' where feature = 'publish';

-- count_click: same as before (20261017000000_click_history.sql); only is_new_window and the pause until midnight
-- for daily limits are new.
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
  -- A daily limit's count starts again when the date changes (in its time zone); else after per_seconds.
  is_new_window boolean;
  next_midnight timestamptz;
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

  select case
      when lim.daily_reset_time_zone is not null
        then (r.window_start at time zone lim.daily_reset_time_zone)::date < (now() at time zone lim.daily_reset_time_zone)::date
      else r.window_start < now() - make_interval(secs => lim.per_seconds)
    end
  into is_new_window
  from public.click_rate r
  where r.user_id = auth.uid() and r.feature = count_click.feature;

  insert into public.click_rate as r (user_id, feature, window_start, clicks)
  values (auth.uid(), count_click.feature, now(), 1)
  on conflict (user_id, feature) do update set
    window_start = case when is_new_window then now() else r.window_start end,
    clicks = case when is_new_window then 1 else r.clicks + 1 end
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
    if lim.daily_reset_time_zone is not null then
      -- A daily limit pauses until the next midnight in its time zone.
      next_midnight := ((now() at time zone lim.daily_reset_time_zone)::date + 1)::timestamp at time zone lim.daily_reset_time_zone;
      minutes := ceil(extract(epoch from next_midnight - now()) / 60)::int;
    else
      minutes := case when streak > 1 then lim.repeat_pause_minutes else lim.first_pause_minutes end;
      next_midnight := null;
    end if;
    update public.click_rate r set
      clicks = 0,
      window_start = now(),
      pause_streak = streak,
      paused_until = coalesce(next_midnight, now() + make_interval(mins => minutes))
    where r.user_id = auth.uid() and r.feature = count_click.feature;
    insert into public.click_history (user_id, feature, kind, pause_minutes, streak)
    values (auth.uid(), count_click.feature, 'pause', minutes, streak);
  end if;
end;
$$;
