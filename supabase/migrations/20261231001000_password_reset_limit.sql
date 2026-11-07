-- The password reset limit (docs/superpowers/specs/2026-11-07-password-reset-limit-design.md): 3 reset emails a day per
-- teacher, Philippine time, and 10 reset requests an hour per internet address.
-- Supabase's own email limit counts the whole project, so these sit next to it. The Forgot password page asks
-- may_send_password_reset before it asks Supabase for the email. Over a limit it shows the same "Check your email"
-- screen, so it never tells who has an account.
-- It can't be a hard wall: Supabase's reset address is public, and it sends the email before it saves anything, so a
-- trigger can't stop the email (it would only break the link). A script that skips the page still needs a fresh person
-- check each time, and what it sends still counts toward that teacher's 3.
-- Keep 3 and 10 the same as RESETS_PER_DAY and RESET_REQUESTS_PER_ADDRESS in src/lib/passwords.ts.

-- One row per reset email really sent, read from Supabase's own recovery_sent_at, so made-up requests don't count.
-- The daily account cleanup (src/lib/cleanupAccounts.ts) deletes rows older than a day: the limit only looks at today.
create table public.password_reset_sends (
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index password_reset_sends_user_id_sent_at on public.password_reset_sends (user_id, sent_at);
alter table public.password_reset_sends enable row level security;
revoke all on public.password_reset_sends from anon, authenticated, public;

-- One row per request on the Forgot password page, like sign_up_attempts. The same cleanup deletes these.
create table public.password_reset_requests (
  ip inet not null,
  created_at timestamptz not null default now()
);
create index password_reset_requests_ip_created_at on public.password_reset_requests (ip, created_at);
alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from anon, authenticated, public;

-- It must never fail the update: Supabase has already sent the email by now, so a failure here would leave the teacher
-- with a dead link. A failure only shows in the database log, and that email isn't counted.
create function public.count_password_reset_send()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.password_reset_sends (user_id) values (new.id);
  return new;
exception when others then
  raise warning 'count_password_reset_send: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.count_password_reset_send() from public, anon, authenticated;

create trigger count_password_reset_send
  after update of recovery_sent_at on auth.users
  for each row
  when (new.recovery_sent_at is not null and new.recovery_sent_at is distinct from old.recovery_sent_at)
  execute function public.count_password_reset_send();

-- May this email get a reset link now? Only the server may ask (the secret key), since it's given the internet address:
-- a browser could make one up. The address is counted first, so every request counts, also one for an email with no
-- account. No address, or one Postgres can't read: that check is skipped, rather than block everyone. On IPv6 one home
-- or school network has countless addresses, so its first half (the /64) counts as the address.
create function public.may_send_password_reset(p_email text, p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_ip inet;
  teacher uuid;
begin
  begin
    client_ip := nullif(p_ip, '')::inet;
  exception when others then
    client_ip := null;
  end;
  if family(client_ip) = 6 then
    client_ip := network(set_masklen(client_ip, 64))::inet;
  end if;

  if client_ip is not null then
    if (
      select count(*) from public.password_reset_requests r
      where r.ip = client_ip and r.created_at > now() - interval '1 hour'
    ) >= 10 then
      return false;
    end if;
    insert into public.password_reset_requests (ip) values (client_ip);
  end if;

  -- is_sso_user = false: what lets Postgres use Supabase's email index (each email once) instead of reading every
  -- account. Supabase saves emails in small letters.
  select u.id into teacher from auth.users u where u.email = lower(trim(p_email)) and u.is_sso_user = false;
  if teacher is null then
    return true;
  end if;
  return (
    select count(*) from public.password_reset_sends s
    where s.user_id = teacher
      and s.sent_at >= public.manila_today()::timestamp at time zone 'Asia/Manila'
  ) < 3;
end;
$$;
revoke execute on function public.may_send_password_reset(text, text) from public, anon, authenticated;
grant execute on function public.may_send_password_reset(text, text) to service_role;
