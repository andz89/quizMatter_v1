-- The table element (supabase/migrations/20261231001100_table_element.sql; an element's `table`, DATA_VERSION 3).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/table_element.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

do $$
begin
  if public.current_data_version() < 3 then
    raise exception 'FAIL: current_data_version() is below 3, so older tabs could save a table away';
  end if;
end $$;

rollback;
