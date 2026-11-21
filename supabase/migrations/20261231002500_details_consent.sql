-- Consent for the sensitive details (birthday, gender, educational background), kept like the sign up agreement.
-- Sign up no longer asks for them (docs/superpowers/specs/2026-11-21-shorter-sign-up-design.md): a teacher adds them,
-- optionally, on the Account page, and saving them there is their consent (the Privacy Policy says so). The row keeps
-- which version of the Privacy Policy that was (sent by the app) and when (the database's own clock).
--
-- Rules (only for a teacher's own writes, current_user = 'authenticated'; sign up's handle_new_user, admins'
-- secret-key client and the SQL editor are left alone):
--   * none of the details filled in → no consent record (both empty);
--   * a new row with them, or a change to any of them → the sent version (else the one kept) and now();
--   * no change to them → the record stays as it was, so a teacher can't rewrite it.

alter table public.user_settings
  add column details_consent_version text check (char_length(details_consent_version) <= 20),
  add column details_consent_at timestamptz;

create or replace function public.stamp_details_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.birth_date is null and new.gender = '' and new.education_level = '' and new.education_field = '' then
    new.details_consent_version := null;
    new.details_consent_at := null;
  elsif tg_op = 'INSERT'
      or (new.birth_date, new.gender, new.education_level, new.education_field)
        is distinct from (old.birth_date, old.gender, old.education_level, old.education_field) then
    -- An update that doesn't send the version carries the old one in `new`.
    new.details_consent_at := now();
  else
    new.details_consent_version := old.details_consent_version;
    new.details_consent_at := old.details_consent_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_details_consent() from public;

create trigger user_settings_stamp_details_consent
  before insert or update on public.user_settings
  for each row execute function public.stamp_details_consent();
