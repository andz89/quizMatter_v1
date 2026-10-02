-- Banning teachers who misuse QuizMatter (Admin → Teachers). An admin bans by hand and writes why.
-- The app also sets Supabase's own ban on the account (it can't log in, and its login stops working within the
-- hour); this table is what stops their saves and photo uploads at once, and remembers the reason.
--
-- Error code the app shows a message for: QMBAN = this account is banned.

create table public.banned_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null check (length(trim(reason)) between 1 and 200),
  banned_at timestamptz not null default now()
);

alter table public.banned_users enable row level security;

-- Only admins see and change bans.
create policy "Admins manage bans" on public.banned_users
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Admins can't be banned (not even by another admin). "security definer" lets it read the admins table.
create function public.check_ban_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.admins where user_id = new.user_id) then
    raise exception 'Admins can''t be banned.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger check_ban_target
  before insert or update on public.banned_users
  for each row execute function public.check_ban_target();

-- True when the logged-in user is banned. For the MCP server, which checks it before doing anything for Claude.
create function public.is_banned()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.banned_users where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_banned() from public, anon;
grant execute on function public.is_banned() to authenticated;

-- count_write (see 20261001020000_fix_count_write.sql) runs on every save and photo upload, so it now also
-- refuses banned users (QMBAN). Only that check is new.
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
