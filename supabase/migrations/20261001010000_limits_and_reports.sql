-- Protection against spam and abuse:
-- 1. At most 100 presentations per teacher (admins: no limit).
-- 2. At most 30 presentation saves and 30 photo uploads per minute per teacher (admins: no limit).
-- 3. Teachers can report other teachers' published presentations; admins can hide or delete them.
--
-- Error codes the app shows a message for: QMMAX = too many presentations, QM429 = too many writes this minute.

-- ─── 1. At most 100 presentations per teacher ───────────────────────────────────────────────────────────────

create function public.check_presentation_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  -- save_presentation's "insert … on conflict do update" runs this for existing presentations too: those are
  -- only being saved again, not added.
  if exists (select 1 from public.presentations p where p.id = new.id) then
    return new;
  end if;
  -- Two new presentations from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  if (select count(*) from public.presentations p where p.owner_id = new.owner_id) >= 100 then
    raise exception 'You have 100 presentations, the most allowed.' using errcode = 'QMMAX';
  end if;
  return new;
end;
$$;

create trigger presentation_limit
  before insert on public.presentations
  for each row execute function public.check_presentation_limit();

-- ─── 2. Speed limits ──────────────────────────────────────────────────────────────────────────────────────

-- How many writes of each kind a user made in their current minute. Nobody reads or changes it through the
-- API (no policies); only count_write below does.
create table public.write_rate (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  window_start timestamptz not null,
  writes int not null,
  primary key (user_id, kind)
);

alter table public.write_rate enable row level security;

-- Counts one write of this kind ('presentations' or 'photos') for the logged-in user, and refuses (QM429) past
-- 30 in one minute. A refused write is rolled back with its count, so the user can write again once the minute
-- is over. Admins aren't counted.
create function public.count_write(kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_writes int;
begin
  if kind not in ('presentations', 'photos') then
    raise exception 'Unknown kind of write.' using errcode = '22023';
  end if;
  if auth.uid() is null or public.is_admin() then
    return;
  end if;

  insert into public.write_rate as w (user_id, kind, window_start, writes)
  values (auth.uid(), kind, now(), 1)
  on conflict (user_id, kind) do update set
    window_start = case when w.window_start < now() - interval '1 minute' then now() else w.window_start end,
    writes = case when w.window_start < now() - interval '1 minute' then 1 else w.writes + 1 end
  returning writes into user_writes;

  if user_writes > 30 then
    raise exception 'Too many saves. Wait a minute and try again.' using errcode = 'QM429';
  end if;
end;
$$;

revoke execute on function public.count_write(text) from public, anon;
grant execute on function public.count_write(text) to authenticated;

-- Every write to presentations or slides counts, from the app or straight to the database. It counts once per
-- request (one database transaction), however many rows it touches: one save = one count.
create function public.count_presentation_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('quizmatter.write_counted', true), '') <> 'yes' then
    perform set_config('quizmatter.write_counted', 'yes', true);
    perform public.count_write('presentations');
  end if;
  return null;
end;
$$;

create trigger count_presentation_write
  after insert or update or delete on public.presentations
  for each statement execute function public.count_presentation_write();

create trigger count_slide_write
  after insert or update or delete on public.slides
  for each statement execute function public.count_presentation_write();

-- Photo uploads call count_write('photos') themselves (src/app/api/upload-image), before the file is stored.

-- ─── 3. Reports, and hiding presentations ──────────────────────────────────────────────────────────────────

-- When an admin hid the presentation (null = not hidden). A hidden presentation is only seen by its owner and
-- admins, even if it's published.
alter table public.presentations add column hidden_at timestamptz;

-- Only admins may hide or unhide. (A rule can't compare old and new values, so a trigger checks it.)
create function public.check_hidden_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_hidden_at timestamptz := null;
begin
  if tg_op = 'UPDATE' then
    old_hidden_at := old.hidden_at;
  end if;
  if new.hidden_at is distinct from old_hidden_at and not public.is_admin() then
    raise exception 'Only admins can hide or unhide a presentation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger check_hidden_change
  before insert or update on public.presentations
  for each row execute function public.check_hidden_change();

-- Other teachers only read published presentations that aren't hidden.
drop policy "Read published presentations" on public.presentations;
create policy "Read published presentations" on public.presentations
  for select to authenticated
  using (is_published and hidden_at is null);

drop policy "Read slides of published presentations" on public.slides;
create policy "Read slides of published presentations" on public.slides
  for select to authenticated
  using (exists (
    select 1 from public.presentations p where p.id = presentation_id and p.is_published and p.hidden_at is null
  ));

-- Admins can see, hide and delete any presentation (to look at reported ones), and read their slides.
create policy "Admins manage every presentation" on public.presentations
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins read every slide" on public.slides
  for select to authenticated
  using ((select public.is_admin()));

-- A teacher's report of another teacher's published presentation. One per teacher per presentation.
create table public.presentation_reports (
  presentation_id text not null references public.presentations (id) on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Same as REPORT_REASON_LABELS in src/lib/schema.ts.
  reason text not null check (reason in ('unsafe', 'spam', 'copied', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  primary key (presentation_id, reporter_id)
);

alter table public.presentation_reports enable row level security;

-- Teachers can only add reports (not read them), for someone else's presentation they can see.
create policy "Report other teachers' presentations" on public.presentation_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.presentations p
      where p.id = presentation_id and p.is_published and p.owner_id <> (select auth.uid())
    )
  );

create policy "Admins manage reports" on public.presentation_reports
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
