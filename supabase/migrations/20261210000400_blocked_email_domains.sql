-- Throwaway emails refused by the database (docs/superpowers/specs/2026-10-24-review-fixes-design.md, D13).
-- Before, only the sign up page knew the throwaway email services (a list in src/lib/blockedEmailDomains.ts, checked
-- by zod), so a script calling Supabase's sign up directly skipped it. Now there is one list, kept here:
-- - blocked_email_domains: one row per throwaway email service, its domain in small letters (e.g. "mailinator.com").
--   Anyone may read it: the sign up page reads it on the server for its instant message. Nobody changes it through
--   the API; add a domain in the Supabase dashboard (Table Editor → blocked_email_domains) or in a new migration.
-- - hook_before_user_created (newest before this: 20261113000000_display_name_rules.sql) also refuses an email whose
--   domain is on the list, with the sign up page's words. It checks the email first, so a refused throwaway sign up
--   isn't counted against its internet address. Supabase gives the hook the email in event -> 'user' ->> 'email'.
-- Test, run as supabase_admin: supabase/tests/blocked_email_domains.sql.

create table public.blocked_email_domains (
  -- Small letters and no spaces, or it would never match: the hook and the sign up page compare in small letters.
  domain text primary key check (domain <> '' and domain = lower(btrim(domain)))
);

-- The hook runs as supabase_auth_admin (it isn't security definer, see 20261108000000_sign_up_limit.sql), and row
-- level security applies to that role too, so it gets its own grant and policy. Without the grant every sign up
-- would fail with "permission denied"; without the policy the hook would see no rows and refuse nobody.
alter table public.blocked_email_domains enable row level security;
revoke all on public.blocked_email_domains from anon, authenticated, public;
grant select on public.blocked_email_domains to anon, authenticated, supabase_auth_admin;
create policy "Anyone reads the blocked email domains" on public.blocked_email_domains
  for select to anon, authenticated, supabase_auth_admin using (true);

-- The 43 domains of the old src/lib/blockedEmailDomains.ts. Only the most common ones: a full list (100,000+) would
-- make the sign up page heavy, and the Turnstile check already stops bots.
insert into public.blocked_email_domains (domain) values
  ('10minutemail.com'),
  ('10minutemail.net'),
  ('20minutemail.com'),
  ('33mail.com'),
  ('discard.email'),
  ('dispostable.com'),
  ('emailondeck.com'),
  ('fakeinbox.com'),
  ('fakemail.net'),
  ('getairmail.com'),
  ('getnada.com'),
  ('grr.la'),
  ('guerrillamail.biz'),
  ('guerrillamail.com'),
  ('guerrillamail.de'),
  ('guerrillamail.net'),
  ('guerrillamail.org'),
  ('guerrillamailblock.com'),
  ('inboxkitten.com'),
  ('jetable.org'),
  ('mailcatch.com'),
  ('maildrop.cc'),
  ('mailinator.com'),
  ('mailinator.net'),
  ('mailnesia.com'),
  ('mintemail.com'),
  ('mohmal.com'),
  ('mytemp.email'),
  ('sharklasers.com'),
  ('spamgourmet.com'),
  ('temp-mail.io'),
  ('temp-mail.org'),
  ('tempail.com'),
  ('tempmail.com'),
  ('tempmail.net'),
  ('tempmailo.com'),
  ('tempr.email'),
  ('throwawaymail.com'),
  ('trashmail.com'),
  ('trashmail.de'),
  ('yopmail.com'),
  ('yopmail.fr'),
  ('yopmail.net');

-- Same as 20261113000000_display_name_rules.sql, plus the throwaway email check at the start.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  client_ip inet;
  -- What comes after the last "@", in small letters (like the sign up page). No email (e.g. a phone sign up): ''.
  email_domain text := lower(split_part(coalesce(event -> 'user' ->> 'email', ''), '@', -1));
begin
  -- A throwaway email service: refused, whatever the internet address. Same words as THROWAWAY_EMAIL_MESSAGE in
  -- src/lib/userSettings.ts, so the sign up page shows them.
  if exists (select 1 from public.blocked_email_domains b where b.domain = email_domain) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Please use your real email address (school or personal), not a throwaway one.'
    ));
  end if;

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
