-- Element effects (Effects panel → Element effects): an element on a blank or title slide can come in on a click
-- while presenting, saved as a new `effect` on the element in a slide's data (src/lib/schema.ts). A new saved field,
-- so DATA_VERSION is now 7 (see "Changing the saved shape" in src/lib/CLAUDE.md): an older editor tab, which doesn't
-- know it, would save the slide without it and the effects would be lost. Raising the cap lets the new app's saves be
-- stored as version 7, so those older tabs are refused (QMOLD). Apply this BEFORE deploying the app with
-- DATA_VERSION 7.
create or replace function public.current_data_version()
returns int
language sql
stable
set search_path = ''
as $$
  -- Same as DATA_VERSION in src/lib/schema.ts.
  select 7;
$$;
