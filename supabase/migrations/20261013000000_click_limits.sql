-- Pausing a feature for teachers who click it too fast (e.g. a script, or clicking every bookmark on the page).
-- Each feature has its own limit in click_limits, e.g. "saved" (bookmarks): 20 clicks in 25 seconds pauses
-- bookmarks for 10 minutes; doing it again within 24 hours of the last pause makes it 1 hour. Only that feature is
-- paused; everything else keeps working. Admins aren't counted.
--
-- To use it for another feature: add a row to click_limits, call count_click('<feature>') from that feature's
-- trigger or database function, and add the feature to CLICK_FEATURES in src/lib/clickLimits.ts.
--
-- The click that reaches the limit still goes through (so the pause is saved with it); the clicks after it are
-- refused until the pause ends. Error code the app shows a message for: QMBLK = this feature is paused. Its
-- `detail` is when the pause ends (Unix ms).

-- ─── 1. The limits, one row per feature ───────────────────────────────────────────────────────────────────
create table public.click_limits (
  feature text primary key,
  max_clicks int not null check (max_clicks > 0),
  per_seconds int not null check (per_seconds > 0),
  first_pause_minutes int not null check (first_pause_minutes > 0),
  -- A pause within `repeat_within_hours` of the last one ended lasts `repeat_pause_minutes` instead.
  repeat_pause_minutes int not null check (repeat_pause_minutes > 0),
  repeat_within_hours int not null check (repeat_within_hours > 0)
);

-- Nobody reads or changes it through the API (no policies); only the functions below do.
alter table public.click_limits enable row level security;

insert into public.click_limits (feature, max_clicks, per_seconds, first_pause_minutes, repeat_pause_minutes, repeat_within_hours)
values ('saved', 20, 25, 10, 60, 24);

-- ─── 2. Each teacher's clicks per feature ─────────────────────────────────────────────────────────────────
create table public.click_rate (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null references public.click_limits (feature) on delete cascade,
  window_start timestamptz not null,
  clicks int not null,
  -- When the current (or last) pause ends; null = never paused.
  paused_until timestamptz,
  primary key (user_id, feature)
);

-- Same: no policies, only the functions below.
alter table public.click_rate enable row level security;

-- ─── 3. Counting a click ──────────────────────────────────────────────────────────────────────────────────
-- Refuses (QMBLK) while the feature is paused. Otherwise counts the click, and pauses the feature when this click
-- reaches the limit.
create function public.count_click(feature text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  lim public.click_limits;
  last_pause timestamptz;
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
  select r.paused_until into last_pause
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

  if user_clicks >= lim.max_clicks then
    update public.click_rate r set
      clicks = 0,
      window_start = now(),
      paused_until = now() + make_interval(mins => case
        when last_pause > now() - make_interval(hours => lim.repeat_within_hours) then lim.repeat_pause_minutes
        else lim.first_pause_minutes
      end)
    where r.user_id = auth.uid() and r.feature = count_click.feature;
  end if;
end;
$$;

revoke execute on function public.count_click(text) from public, anon;
grant execute on function public.count_click(text) to authenticated;

-- ─── 4. The app asks which features are paused for me (to grey out their buttons) ─────────────────────────
create function public.my_paused_features()
returns table (feature text, paused_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.feature, r.paused_until
  from public.click_rate r
  where r.user_id = (select auth.uid()) and r.paused_until > now();
$$;

revoke execute on function public.my_paused_features() from public, anon;
grant execute on function public.my_paused_features() to authenticated;

-- ─── 5. Bookmarks (saved_presentations) count their clicks ────────────────────────────────────────────────
-- Same as before (20261012000000_saved_limits.sql), with count_click first, so a paused teacher is told so.
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
  if (select count(*) from public.saved_presentations s where s.user_id = new.user_id) >= 500 then
    raise exception 'You have 500 saved presentations, the most allowed.' using errcode = 'QMSAV';
  end if;
  return new;
end;
$$;

create or replace function public.count_saved_removal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.user_id = (select auth.uid()) then
    perform public.count_click('saved');
    perform public.count_write('saved');
  end if;
  return old;
end;
$$;
