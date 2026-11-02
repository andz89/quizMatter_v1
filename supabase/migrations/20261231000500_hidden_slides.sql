-- Hidden slides: a slide can be hidden from presenting (the `hidden` field in its data; src/lib/schema.ts). It's a
-- new saved field, so DATA_VERSION is now 1 (see "Changing the saved shape" in src/lib/CLAUDE.md): an older editor
-- tab, which doesn't know the field, would save the slide without it and show it again. Raising the cap lets the
-- new app's saves be stored as version 1, so those older tabs are refused (QMOLD) instead.
-- Apply this BEFORE deploying the app with DATA_VERSION 1.
create or replace function public.current_data_version()
returns int
language sql
stable
set search_path = ''
as $$
  -- Same as DATA_VERSION in src/lib/schema.ts.
  select 1;
$$;
