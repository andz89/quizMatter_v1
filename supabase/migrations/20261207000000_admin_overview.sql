-- Admin → Overview: the charts and the "to do" counts.
-- Design: docs/superpowers/specs/2026-10-23-admin-overview-design.md (section 2).
--
-- Likes, saves and reports can be taken back (the row is deleted), so counting the rows would make old days
-- shrink. So each one also writes an "event" row that stays. Everything else is counted from tables that keep
-- their dates. Days are UTC dates.

-- ─── 1. Activity events (a like, a save or a report happened) ─────────────────────────────────────────────
create table public.activity_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('like', 'save', 'report')),
  created_at timestamptz not null default now()
);

create index activity_events_kind_created_at on public.activity_events (kind, created_at);

-- Nobody reads it directly: RLS on, no policies. Only admin_overview reads it.
alter table public.activity_events enable row level security;

-- One trigger function for all three tables; the trigger passes the kind as its argument.
create function public.record_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_events (kind) values (tg_argv[0]);
  return new;
end;
$$;

revoke execute on function public.record_activity_event() from public, anon, authenticated;

create trigger record_like_event
  after insert on public.presentation_likes
  for each row execute function public.record_activity_event('like');

create trigger record_save_event
  after insert on public.saved_presentations
  for each row execute function public.record_activity_event('save');

create trigger record_report_event
  after insert on public.presentation_reports
  for each row execute function public.record_activity_event('report');

-- ─── 2. admin_overview: one row per series per day (only days with something) ─────────────────────────────
-- Every admin sees the first seven series. Sign-ups, logins, pauses and bans are for the super admin only.
-- Reviews are counted by the date of the latest round's submit (a send-back keeps its old date).
create function public.admin_overview(days int)
returns table (series text, day date, total int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since timestamptz := ((now() at time zone 'utc')::date - (days - 1)) at time zone 'utc';
begin
  if not public.is_admin() then
    raise exception 'Only admins can see the overview.' using errcode = '42501';
  end if;
  if days not in (7, 30, 90) then
    raise exception 'days must be 7, 30 or 90.' using errcode = '22023';
  end if;

  return query
  select s.series, s.day, count(*)::int
  from (
    select case when p.shared_from is null then 'presentations' else 'publishes' end as series,
           (p.created_at at time zone 'utc')::date as day
      from public.presentations p where p.created_at >= since
    union all
    select case e.kind when 'like' then 'likes' when 'save' then 'saves' else 'reports' end,
           (e.created_at at time zone 'utc')::date
      from public.activity_events e where e.created_at >= since
    union all
    select 'submissions', (x.submitted_at at time zone 'utc')::date
      from public.presentation_submissions x where x.submitted_at >= since
    union all
    select 'reviews', (r.submitted_at at time zone 'utc')::date
      from public.presentation_reviews r where r.submitted_at >= since
    union all
    select 'signups', (u.created_at at time zone 'utc')::date
      from auth.users u where public.is_super_admin() and u.created_at >= since
    union all
    select 'logins', (u.last_sign_in_at at time zone 'utc')::date
      from auth.users u where public.is_super_admin() and u.last_sign_in_at >= since
    union all
    select case h.kind when 'pause' then 'pauses' else 'bans' end,
           (h.created_at at time zone 'utc')::date
      from public.click_history h
      where public.is_super_admin() and h.kind in ('pause', 'ban') and h.created_at >= since
  ) s
  group by s.series, s.day;
end;
$$;

-- ─── 3. admin_todo_counts: what waits for an admin ────────────────────────────────────────────────────────
-- reports counts presentations with a report (what Admin → Reports lists), not single reports.
create function public.admin_todo_counts()
returns table (reviews int, submissions int, reports int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see this.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::int from public.presentation_reviews where status = 'submitted'),
    (select count(*)::int from public.presentation_submissions where status = 'submitted'),
    (select count(distinct presentation_id)::int from public.presentation_reports);
end;
$$;

revoke execute on function public.admin_overview(int) from public, anon;
grant execute on function public.admin_overview(int) to authenticated;
revoke execute on function public.admin_todo_counts() from public, anon;
grant execute on function public.admin_todo_counts() to authenticated;
