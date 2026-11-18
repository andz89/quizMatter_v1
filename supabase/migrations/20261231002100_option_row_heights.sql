-- Option row heights (Fit rows to text, the lines between option rows): each option's row size is a new `rowSize`
-- on an option, and a grid's two row sizes a new `gridRowSizes`, in a slide's data (src/lib/schema.ts). New saved
-- fields, so DATA_VERSION is now 6 (see "Changing the saved shape" in src/lib/CLAUDE.md): an older editor tab, which
-- doesn't know them, would save the slide without them and the rows would go back to equal. Raising the cap lets
-- the new app's saves be stored as version 6, so those older tabs are refused (QMOLD). Apply this BEFORE deploying
-- the app with DATA_VERSION 6.
create or replace function public.current_data_version()
returns int
language sql
stable
set search_path = ''
as $$
  -- Same as DATA_VERSION in src/lib/schema.ts.
  select 6;
$$;
