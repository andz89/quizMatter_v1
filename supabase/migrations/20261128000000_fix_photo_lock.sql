-- Fix for 20261127000000_editor_photo_fixes.sql: refuse_locked_photo_delete read old.user_id inside a CASE, and the
-- database checks every field an expression names, even on the branch it doesn't take. shared_photos has no
-- user_id, so every delete from shared_photos failed (Admin → Photos ✕, and an editor removing a waiting photo).
-- The owner is now read through to_jsonb, which gives null for a table without the field.
create or replace function public.refuse_locked_photo_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- "My photos" (photos): only the person removing it. The shared library (shared_photos, no user_id): anyone's.
  owner uuid := case when tg_table_name = 'photos' then (to_jsonb(old) ->> 'user_id')::uuid end;
begin
  if auth.uid() is not null and public.photo_waiting_for_approval(old.src, owner) then
    raise exception 'This photo is in a presentation waiting for QuizMatter, so it can''t be removed yet.'
      using errcode = 'QMPHL';
  end if;
  return old;
end;
$$;
