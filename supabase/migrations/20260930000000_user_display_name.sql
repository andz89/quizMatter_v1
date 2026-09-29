-- The name a user picks on the Account page (e.g. "Ms. Cruz"): shown in the account menu, and filled in as
-- the Author of their new presentations. Empty until they set one.
-- The limit is checked with zod first (displayNameSchema in src/lib/userSettings.ts).

alter table public.user_settings
  add column display_name text not null default '' check (length(display_name) <= 80);
