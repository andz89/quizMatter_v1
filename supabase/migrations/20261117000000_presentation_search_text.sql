-- Faster home page search. The search looks for each typed word anywhere in a presentation's details, e.g.
-- "adding fractions" finds "Fractions: adding and subtracting". Instead of checking eight columns one by one, it
-- checks one: search_text, all those details joined into one line of text. The database keeps it up to date by
-- itself (a generated column).
--
-- A trigram index makes "contains this word" fast: the database remembers every 3-letter piece of the text
-- ("fra", "rac", "act"…), so it finds the matching rows without reading every presentation. pg_trgm comes with
-- Supabase.

create extension if not exists pg_trgm with schema extensions;

-- Same details "Includes the words" and "Doesn't have" look in (src/app/page.tsx). coalesce: so one empty detail
-- doesn't empty the whole line. (tags_text is generated itself, so the tags are joined again with the same function.)
alter table public.presentations
  add column search_text text generated always as (
    coalesce(title, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(week, '') || ' ' || coalesce(day, '') || ' '
      || coalesce(curriculum, '') || ' ' || coalesce(learning_competency, '') || ' ' || coalesce(author, '') || ' '
      || public.tags_text(tags)
  ) stored;

create index presentations_search_text_trgm_idx on public.presentations using gin (search_text extensions.gin_trgm_ops);
