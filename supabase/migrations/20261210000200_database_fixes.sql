-- Database fixes from the deep review (spec docs/superpowers/specs/2026-10-24-review-fixes-design.md, D5, D6, D8,
-- D10; D7 was a change to 20261122000000_super_admin.sql itself, which only matters on a fresh database).
-- 1. Deleting an account can't get stuck on a hidden shared copy. Postgres deletes the account's presentations one
--    by one; when it reached the hidden copy before its original (the original was saved again after sharing),
--    check_hidden_copy_delete saw the original still there and refused, so the whole account delete failed.
-- 2. The Admin log gets a row for every presentation hidden, shown, shared or moved, and every shared photo deleted,
--    when one change touches several rows. Before, only the first row was logged: the "already logged" flag
--    (quizmatter.admin_logged) stopped the others. Deleting presentations already logged every row.
-- 3. check_review_draft also checks what the presentations table checks (tags, grades, slide effect and its speed),
--    so a bad draft is refused when it's saved, not later when an admin publishes it.
-- 4. The "From editors" photo category can't be renamed or deleted: editors' uploads find it by that name.

-- ─── 1. check_hidden_copy_delete: same as before (20261124000000_shared_copy_moderation.sql), plus the skip ─────
-- Only a logged-in person deleting the copy itself (Private, or a direct delete) is checked. Skipped when there's no
-- logged-in user (deleting an account from the dashboard, the daily cleanup of unconfirmed ones) or when another
-- trigger or a cascade removes the row (pg_trigger_depth() > 1: its original or its account being deleted, Move to
-- QuizMatter, the editor role removing copies).
create or replace function public.check_hidden_copy_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.shared_from is not null and old.hidden_at is not null and not public.is_admin()
    and exists (select 1 from public.presentations p where p.id = old.shared_from) then
    raise exception 'QuizMatter hid the shared copy, so it can''t be made private.' using errcode = '42501';
  end if;
  return old;
end;
$$;

-- ─── 2. The Admin log: a row for every row ────────────────────────────────────────────────────────────────────
-- Like log_presentation_delete: each row a statement changes is its own step, so the flag is cleared before the row
-- is logged. A row changed by another trigger (pg_trigger_depth() > 1) is a side effect of a step: it keeps the
-- flag, as before, so it isn't logged when its step already was. "create or replace" keeps the revoke.

-- log_presentation_change: same as before (20261208000000_admin_log.sql), plus clearing the flag. A row with
-- nothing to log leaves the flag alone.
create or replace function public.log_presentation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action text;
begin
  if new.from_admin and not old.from_admin then
    action := 'presentation_moved';
  elsif new.from_admin and new.is_published is distinct from old.is_published then
    action := case when new.is_published then 'presentation_shared' else 'presentation_unshared' end;
  elsif (new.hidden_at is null) <> (old.hidden_at is null) then
    action := case when new.hidden_at is null then 'presentation_unhidden' else 'presentation_hidden' end;
  end if;
  if action is not null then
    if pg_trigger_depth() = 1 then
      perform set_config('quizmatter.admin_logged', '', true);
    end if;
    perform public.log_admin_action(action, 'presentation', new.id, new.title, null);
  end if;
  return new;
end;
$$;

-- log_shared_photo_delete: same as before (20261208000000_admin_log.sql), plus clearing the flag.
create or replace function public.log_shared_photo_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 then
    perform set_config('quizmatter.admin_logged', '', true);
  end if;
  perform public.log_admin_action('photo_deleted', 'photo', old.src, old.file_name, null);
  return old;
end;
$$;

-- ─── 3. check_review_draft: same as before (20261118000000_presentation_term.sql), plus the table's checks ──────
-- publish_review copies these into the presentations row, whose checks would refuse them only then.
-- "create or replace" keeps the revoke.
create or replace function public.check_review_draft(target_id text, review_draft jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  slide_count int := jsonb_array_length(coalesce(review_draft -> 'slides', '[]'));
begin
  if review_draft ->> 'id' is distinct from target_id then
    raise exception 'The draft is for another presentation.' using errcode = '22023';
  end if;
  if slide_count = 0 or slide_count > 100 then
    raise exception 'A presentation needs 1 to 100 slides.' using errcode = '22023';
  end if;
  if octet_length(review_draft::text) > 5000000 then
    raise exception 'The draft is too big.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(review_draft -> 'slides') as slide
    where jsonb_typeof(slide) <> 'object' or coalesce(slide ->> 'id', '') = '' or octet_length(slide::text) > 2000000
  ) or (
    select count(distinct slide ->> 'id') from jsonb_array_elements(review_draft -> 'slides') as slide
  ) <> slide_count then
    raise exception 'Every slide needs its own id and must be at most 2 MB.' using errcode = '22023';
  end if;
  if not coalesce(
    char_length(review_draft ->> 'title') <= 120
      and char_length(review_draft ->> 'description') <= 1000
      and char_length(review_draft ->> 'subject') <= 80
      and char_length(coalesce(review_draft ->> 'term', '')) <= 40
      and char_length(coalesce(review_draft ->> 'week', '')) <= 40
      and char_length(coalesce(review_draft ->> 'day', '')) <= 40
      and char_length(review_draft ->> 'curriculum') <= 80
      and char_length(review_draft ->> 'learningCompetency') <= 1000
      and jsonb_array_length(coalesce(review_draft -> 'referenceLinks', '[]')) <= 20,
    true
  ) then
    raise exception 'A detail of the draft is too long.' using errcode = '22023';
  end if;
  -- Same limits as MAX_TAGS, MAX_GRADES, SLIDE_TRANSITIONS and SLIDE_EFFECT_SPEED_MIN / _MAX in src/lib/schema.ts
  -- (and the presentations table's checks). A missing one gets publish_review's default, so it passes. The speed is
  -- compared as text, so "2.5" or "fast" is refused here instead of breaking publish_review's number cast.
  if jsonb_array_length(coalesce(review_draft -> 'tags', '[]')) > 10
    or cardinality(public.grades_from(review_draft)) > 14
    or coalesce(review_draft ->> 'transition', 'slide') not in ('none', 'fade', 'slide', 'zoom')
    or coalesce(review_draft ->> 'transitionSpeed', '3') not in ('1', '2', '3', '4', '5') then
    raise exception 'The draft has too many tags or grades, or a slide effect that doesn''t exist.'
      using errcode = '22023';
  end if;
end;
$$;

-- ─── 4. The "From editors" category stays ─────────────────────────────────────────────────────────────────────
-- share_editor_photo and share_new_editor_photos put editors' uploads in the category named "From editors" (any
-- capitals). Renamed or deleted, new editor uploads would quietly stop reaching Admin → Photos. Refused for
-- everyone. It runs before log_category_change (triggers run in A–Z order), so a refused change isn't logged.
-- Made again first, in case it was deleted before this file ran (an empty one could be).
insert into public.photo_categories (name) values ('From editors') on conflict do nothing;

create function public.keep_editor_category()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if lower(old.name) = 'from editors' and (tg_op = 'DELETE' or new.name is distinct from old.name) then
    raise exception 'This category holds editors'' photos, so it can''t be renamed or deleted.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger keep_editor_category
  before update of name or delete on public.photo_categories
  for each row execute function public.keep_editor_category();
