-- Mixed fraction (Elements → Math tools): its whole number is a new `whole` inside an element's `fraction` in its
-- slide's data (src/lib/schema.ts). It's a new saved field, so DATA_VERSION is now 5 (see "Changing the saved shape"
-- in src/lib/CLAUDE.md): an older editor tab, which doesn't know the field, would save the mixed fraction without
-- its whole number. Raising the cap lets the new app's saves be stored as version 5, so those older tabs are refused
-- (QMOLD). Apply this BEFORE deploying the app with DATA_VERSION 5.
create or replace function public.current_data_version()
returns int
language sql
stable
set search_path = ''
as $$
  -- Same as DATA_VERSION in src/lib/schema.ts.
  select 5;
$$;
