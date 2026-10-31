-- Announcements that keep working with many teachers (notes: the root CLAUDE.md, "Announcements").
-- - announcement_count(a) counts every matching account in one query, with the same rule as announcement_matches
--   (which checks one teacher, for their own list). Counting one account at a time took about 5 seconds per 100,000
--   accounts, and the logged-in role stops a request after 8 seconds, so it would have failed at about 160,000
--   teachers. Change the two together: supabase/tests/announcement_fast_counts.sql checks they agree.
-- - announcement_audience and count_announcement count with announcement_count.
-- - save_announcement no longer counts: the app asks for the count next (recount_announcement), so a count that
--   fails can't undo a save.
-- - cleanup_announcement_dismissals(batch_size) deletes at most batch_size rows a call (the daily timer calls it
--   a few times), so one announcement closed by a million teachers isn't one huge delete. It first keeps the
--   closed counts of each announcement that ended over 30 days ago.
-- Tests: supabase/tests/announcement_fast_counts.sql, supabase/tests/announcement_counts.sql.

-- ─── 1. Counting every account in one query ──────────────────────────────────────────────────────────────────
-- The same rule as announcement_matches (one teacher, 20261221000000_announcements.sql), written into one query
-- over every account: Postgres can't merge a function rule into a query this size, and running it once per account
-- took about 5 seconds per 100,000 accounts (the logged-in role stops a request after 8 seconds). This way it's
-- well under a tenth of a second per 100,000. CHANGE BOTH TOGETHER: supabase/tests/announcement_fast_counts.sql
-- checks that they agree. "Today" is worked out once; presentations are counted (once, for everyone) only when
-- that filter is set.
create function public.announcement_count(a public.announcements)
returns int
language plpgsql
stable
set search_path = ''
as $$
declare
  today date := public.manila_today();
  wants_presentations boolean := a.presentations_min is not null or a.presentations_max is not null;
begin
  return (
    select count(*)
    from public.user_settings s
    left join (
      select p.owner_id, count(*) as n
      from public.presentations p
      where wants_presentations and p.shared_from is null
      group by p.owner_id
    ) own on own.owner_id = s.user_id
    where not exists (select 1 from public.banned_users b where b.user_id = s.user_id)
      and (coalesce(cardinality(a.genders), 0) = 0 or s.gender = any (a.genders))
      and (a.age_min is null or (s.birth_date is not null and
        extract(year from today)::int - extract(year from s.birth_date)::int
        - case when (extract(month from today), extract(day from today))
            < (extract(month from s.birth_date), extract(day from s.birth_date)) then 1 else 0 end >= a.age_min))
      and (a.age_max is null or (s.birth_date is not null and
        extract(year from today)::int - extract(year from s.birth_date)::int
        - case when (extract(month from today), extract(day from today))
            < (extract(month from s.birth_date), extract(day from s.birth_date)) then 1 else 0 end <= a.age_max))
      and (coalesce(cardinality(a.provinces), 0) = 0 or s.province = any (a.provinces))
      and (coalesce(cardinality(a.town_words), 0) = 0 or (s.town <> '' and exists (
        select 1 from unnest(a.town_words) w where position(lower(w) in lower(s.town)) > 0)))
      and (coalesce(cardinality(a.education_levels), 0) = 0 or s.education_level = any (a.education_levels))
      and (coalesce(cardinality(a.field_words), 0) = 0 or (s.education_field <> '' and exists (
        select 1 from unnest(a.field_words) w where position(lower(w) in lower(s.education_field)) > 0)))
      and (not wants_presentations
        or coalesce(own.n, 0) between coalesce(a.presentations_min, 0) and coalesce(a.presentations_max, 2147483647))
      and (coalesce(cardinality(a.roles), 0) = 0
        or ('editor' = any (a.roles) and exists (select 1 from public.editors e where e.user_id = s.user_id))
        or ('admin' = any (a.roles) and exists (select 1 from public.admins ad where ad.user_id = s.user_id))
        or ('teacher' = any (a.roles)
          and not exists (select 1 from public.editors e where e.user_id = s.user_id)
          and not exists (select 1 from public.admins ad where ad.user_id = s.user_id)))
  );
end;
$$;

-- ─── 2. Counting with it ──────────────────────────────────────────────────────────────────────────────────────
-- The form's "Count teachers". `a` has the filter columns as keys (missing ones = no filter).
create or replace function public.announcement_audience(a jsonb)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  return public.announcement_count(jsonb_populate_record(null::public.announcements, a));
end;
$$;

-- Counts one announcement now (save's next step and "Count again"): how many accounts match it, and (until its
-- cleanup) how many closed each part. Doesn't change updated_at, so the announcements key stays the same.
create or replace function public.count_announcement(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.announcements;
begin
  select * into a from public.announcements where id = target;
  if not found then
    return;
  end if;
  update public.announcements x set
    matched_count = public.announcement_count(a),
    closed_modal_count = case when x.closed_cleared_at is null then (select count(*) from public.announcement_dismissals d
      where d.announcement_id = target and d.part = 'modal') else x.closed_modal_count end,
    closed_bar_count = case when x.closed_cleared_at is null then (select count(*) from public.announcement_dismissals d
      where d.announcement_id = target and d.part = 'bar') else x.closed_bar_count end,
    counted_at = now()
  where x.id = target;
end;
$$;

-- ─── 3. Saving without counting ───────────────────────────────────────────────────────────────────────────────
-- `a` has the column names as keys; no id (or null) = a new one. updated_at takes the clock's time (not the
-- transaction's), so announcements_key changes with every save. The app counts it next (recount_announcement).
create or replace function public.save_announcement(a jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.announcements := jsonb_populate_record(null::public.announcements, a);
  saved_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  if r.id is null then
    insert into public.announcements (
      name, is_on, starts_at, ends_at, show_modal, modal_html, modal_close_after, show_bar, bar_html,
      bar_close_after, repeat, pages, genders, age_min, age_max, provinces, town_words, education_levels,
      field_words, presentations_min, presentations_max, roles, modal_size, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, r.modal_html, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max, r.provinces, r.town_words,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'), auth.uid(), now(),
      clock_timestamp()
    )
    returning id into saved_id;
  else
    update public.announcements x set
      name = btrim(r.name), is_on = r.is_on, starts_at = r.starts_at, ends_at = r.ends_at,
      show_modal = r.show_modal, modal_html = r.modal_html, modal_close_after = r.modal_close_after,
      show_bar = r.show_bar, bar_html = r.bar_html, bar_close_after = r.bar_close_after, repeat = r.repeat,
      pages = r.pages, genders = r.genders, age_min = r.age_min, age_max = r.age_max, provinces = r.provinces,
      town_words = r.town_words, education_levels = r.education_levels, field_words = r.field_words,
      presentations_min = r.presentations_min, presentations_max = r.presentations_max, roles = r.roles,
      modal_size = coalesce(r.modal_size, 'large'), updated_at = clock_timestamp(),
      -- Ending later again after its cleanup: its closed rows start over (they were deleted).
      closed_cleared_at = case when r.ends_at is null or r.ends_at > now() then null else x.closed_cleared_at end
    where x.id = r.id
    returning x.id into saved_id;
    if saved_id is null then
      raise exception 'This announcement was deleted.' using errcode = 'P0002';
    end if;
  end if;

  perform public.check_announcement_limit();
  perform public.log_admin_action('announcement_saved', 'announcement', saved_id::text, btrim(r.name), null);
  return saved_id;
end;
$$;

-- ─── 4. The cleanup, in batches ───────────────────────────────────────────────────────────────────────────────
drop function public.cleanup_announcement_dismissals();
-- The daily timer (src/lib/cleanupAccounts.ts) calls it until it deletes fewer than batch_size. Returns how many
-- rows it deleted.
create function public.cleanup_announcement_dismissals(batch_size int default 50000)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted int;
begin
  -- Keep the closed counts of each announcement newly over 30 days past its end (once).
  update public.announcements x set
    closed_modal_count = (select count(*) from public.announcement_dismissals d
      where d.announcement_id = x.id and d.part = 'modal'),
    closed_bar_count = (select count(*) from public.announcement_dismissals d
      where d.announcement_id = x.id and d.part = 'bar'),
    closed_cleared_at = now()
  where x.ends_at <= now() - interval '30 days' and x.closed_cleared_at is null;

  delete from public.announcement_dismissals d
  where d.ctid in (
    select d2.ctid
    from public.announcement_dismissals d2
    join public.announcements a on a.id = d2.announcement_id
    where a.closed_cleared_at is not null and a.ends_at <= now() - interval '30 days'
    limit batch_size
  );
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.announcement_count(public.announcements) from public, anon, authenticated;
revoke execute on function public.cleanup_announcement_dismissals(int) from public, anon, authenticated;
grant execute on function public.cleanup_announcement_dismissals(int) to service_role;
