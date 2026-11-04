-- Moderation fixes (found by a security review; test: supabase/tests/moderation_fixes.sql).
-- 1. A plain admin hides or shows only a teacher's shared copy (Admin → Reports), never a QuizMatter lesson or a
--    private presentation. Before, they could hide anything (guard_admin_presentation_update let hidden_at change on
--    every row), and a hidden presentation could then be deleted, so "delete only what is hidden or reported" didn't
--    limit them at all. The super admin still hides anything.
-- 2. A plain admin deletes someone else's presentation only when it is a teacher's (not QuizMatter's) and its shared
--    copy is hidden or reported. Before, a report row they added themselves ("Admins manage reports") on a
--    QuizMatter lesson or a private presentation was enough. Their own presentations still go through
--    "Own presentations", and the super admin's deletes through "Super admin manages every presentation".
-- 3. Banning an editor (by hand or automatically) takes the editor role away. Removing the role already cancels
--    their open review round and their waiting submissions (cancel_reviews_of_removed_editor), so the presentation
--    isn't left locked. Unbanning doesn't give the role back.

-- ─── 1. Hiding ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_admin_presentation_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' or public.is_super_admin() then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id or new.from_admin is distinct from old.from_admin then
    raise exception 'Only the super admin can change who owns a presentation or move it to QuizMatter.'
      using errcode = '42501';
  end if;
  -- tags_text and search_text are worked out by the database (null in NEW here), so they're left out.
  if old.owner_id is distinct from auth.uid()
    and (to_jsonb(new) - 'hidden_at' - 'tags_text' - 'search_text') <> (to_jsonb(old) - 'hidden_at' - 'tags_text' - 'search_text') then
    raise exception 'Admins can only hide or show someone else''s presentation.' using errcode = '42501';
  end if;
  -- Only a teacher's shared copy (what teachers see and report). QuizMatter lessons and private presentations are
  -- the super admin's to hide.
  if old.owner_id is distinct from auth.uid() and new.hidden_at is distinct from old.hidden_at
    and (old.shared_from is null or old.from_admin) then
    raise exception 'Admins can only hide or show a teacher''s published copy.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ─── 2. Deleting ──────────────────────────────────────────────────────────────────────────────────────────────
-- True when the caller is an admin and target_id is a teacher's presentation whose shared copy is hidden or
-- reported (Reports → Delete deletes the original; the copy goes with it). "security definer": the check reads
-- presentations, and a policy on presentations that reads presentations itself stops with "infinite recursion".
create or replace function public.admin_may_delete(target_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() and exists (
    select 1
    from public.presentations original
    join public.presentations copy on copy.shared_from = original.id
    where original.id = target_id
      and not original.from_admin
      and (
        copy.hidden_at is not null
        or exists (select 1 from public.presentation_reports r where r.presentation_id = copy.id)
      )
  );
$$;

-- ─── 3. Banning an editor ─────────────────────────────────────────────────────────────────────────────────────
-- "security definer": an automatic ban runs as the teacher being banned, who can't remove editors.
create function public.remove_banned_editor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.editors e where e.user_id = new.user_id;
  return new;
end;
$$;

revoke execute on function public.remove_banned_editor() from public, anon, authenticated;

create trigger remove_banned_editor
  after insert on public.banned_users
  for each row execute function public.remove_banned_editor();
