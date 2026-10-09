-- Sign up limit per internet address (docs/superpowers/specs/2026-10-09-sign-up-spam-limits-design.md).
-- Supabase Auth calls hook_before_user_created just before it makes a new account. If 10 accounts were already made
-- from the same internet address in the last hour, it refuses: no account is made and no email is sent. Scripts and
-- cleared browsers can't skip it, since Supabase runs it itself.
-- Turn it on in the Supabase dashboard: Authentication → Hooks → Before User Created → Postgres →
-- public.hook_before_user_created.
-- Keep 10 the same as SIGN_UPS_PER_ADDRESS in src/lib/browserLimits.ts (Admin → Safety shows that one).
-- The daily account cleanup (src/lib/cleanupAccounts.ts) deletes rows older than a day.

create table public.sign_up_attempts (
  ip inet not null,
  created_at timestamptz not null default now()
);
create index sign_up_attempts_ip_created_at on public.sign_up_attempts (ip, created_at);

-- Only Supabase Auth (and the secret key) may read or write it. Row level security applies to supabase_auth_admin
-- too, so it needs its own policies (the secret key skips row level security).
alter table public.sign_up_attempts enable row level security;
revoke all on public.sign_up_attempts from anon, authenticated, public;
grant usage on schema public to supabase_auth_admin;
grant select, insert on public.sign_up_attempts to supabase_auth_admin;
create policy "Auth reads sign up attempts" on public.sign_up_attempts
  for select to supabase_auth_admin using (true);
create policy "Auth adds sign up attempts" on public.sign_up_attempts
  for insert to supabase_auth_admin with check (true);

-- No security definer: Supabase advises running hooks as supabase_auth_admin with only the rights granted above.
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  client_ip inet;
begin
  -- No address, or one Postgres can't read (shouldn't happen): allow, rather than block everyone.
  begin
    client_ip := nullif(event -> 'metadata' ->> 'ip_address', '')::inet;
  exception when others then
    client_ip := null;
  end;
  if client_ip is null then
    return '{}'::jsonb;
  end if;

  if (
    select count(*) from public.sign_up_attempts a
    where a.ip = client_ip and a.created_at > now() - interval '1 hour'
  ) >= 10 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'Too many accounts were made from this internet connection. Please try again in an hour.'
    ));
  end if;

  insert into public.sign_up_attempts (ip) values (client_ip);
  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from anon, authenticated, public;
