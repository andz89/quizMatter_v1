-- Calendar dates: the Calendar Page and Month Calendar elements keep the date they show (the element's `calendarDate`
-- in its slide's data; src/lib/schema.ts). It's a new saved field, so DATA_VERSION is now 2 (see "Changing the saved
-- shape" in src/lib/CLAUDE.md): an older editor tab, which doesn't know the field, would save the calendar without
-- its date. Raising the cap lets the new app's saves be stored as version 2, so those older tabs are refused (QMOLD).
-- Apply this BEFORE deploying the app with DATA_VERSION 2.
create or replace function public.current_data_version()
returns int
language sql
stable
set search_path = ''
as $$
  -- Same as DATA_VERSION in src/lib/schema.ts.
  select 2;
$$;
