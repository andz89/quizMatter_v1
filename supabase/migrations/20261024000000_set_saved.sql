-- Bookmarks (saved_presentations) are now added and removed only through set_saved(), not by writing to the table.
-- Before, count_click('saved') ran inside the table's triggers, in the same transaction as the insert. When the
-- insert then failed (already saved, too many saved, not allowed), the click count, the pause, the automatic ban
-- and its click_history row were all undone with it, so a script sending failing saves was never paused. And on
-- the click that banned, the bookmark was still saved and the teacher saw "Saved.".
--
-- set_saved() counts the click first and then answers with a word instead of an error, so what count_click wrote
-- is kept. Its checks are the same as the old triggers and the "Save other people's presentations" policy.

-- ─── 1. The old triggers (set_saved does their work now) ──────────────────────────────────────────────────
drop trigger saved_limit on public.saved_presentations;
drop trigger saved_removal_rate on public.saved_presentations;
drop function public.check_saved_limit();
drop function public.count_saved_removal();

-- Teachers can still read their bookmarks, but only change them through set_saved, so no click skips the count.
revoke insert, delete on public.saved_presentations from anon, authenticated;

-- ─── 2. set_saved: save (is_saved true) or remove a bookmark ──────────────────────────────────────────────
-- Answers 'done', 'limit' (MAX_SAVED reached), 'banned' or 'failed' (not a presentation I may save). A paused
-- teacher gets count_click's error (QMBLK), as before. Already saved / already removed is 'done'.
create function public.set_saved(presentation_id text, is_saved boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    return 'failed';
  end if;
  if public.is_banned() then
    return 'banned';
  end if;
  perform public.count_click('saved');
  -- This click may have just banned them (see count_click): nothing is saved, and they're told at once.
  if public.is_banned() then
    return 'banned';
  end if;

  if not is_saved then
    delete from public.saved_presentations s where s.user_id = me and s.presentation_id = set_saved.presentation_id;
    return 'done';
  end if;

  -- Only someone else's presentation that they can see (published and not hidden).
  if not exists (
    select 1 from public.presentations p
    where p.id = set_saved.presentation_id and p.is_published and p.hidden_at is null and p.owner_id <> me
  ) then
    return 'failed';
  end if;

  -- Two saves from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext('saved:' || me::text));
  if exists (select 1 from public.saved_presentations s where s.user_id = me and s.presentation_id = set_saved.presentation_id) then
    return 'done';
  end if;
  -- Same as MAX_SAVED in src/lib/schema.ts.
  if (select count(*) from public.saved_presentations s where s.user_id = me) >= 50 then
    return 'limit';
  end if;

  insert into public.saved_presentations (user_id, presentation_id) values (me, set_saved.presentation_id);
  return 'done';
end;
$$;

revoke execute on function public.set_saved(text, boolean) from public, anon;
grant execute on function public.set_saved(text, boolean) to authenticated;
