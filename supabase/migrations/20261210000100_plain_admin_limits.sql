-- Plain admins follow their limits in the database too, not only in the app (spec
-- docs/superpowers/specs/2026-10-24-review-fixes-design.md, D1–D4; what plain admins may do:
-- docs/superpowers/specs/2026-10-16-super-admin-design.md, "What plain admins can do").
-- Before, "Admins manage every presentation" and "Admins manage editors" let any admin, with a direct API call,
-- change any presentation's owner, title, author or "from QuizMatter" (Move to QuizMatter), add rows owned by
-- someone else, and make anyone an editor (which removes their published copies). The app only hid the buttons.
-- 1. Presentations: every admin reads every one. The super admin may change anything. On someone else's
--    presentation a plain admin may only hide or show it (guard_admin_presentation_update), and delete it only when
--    it, or its shared copy, is hidden or reported. Owner and "from QuizMatter" change only by the super admin.
-- 2. A former admin (taken out of admins) can't delete QuizMatter presentations.
-- 3. Editors: only the super admin gives the role, never to an admin or a banned teacher. Any admin takes it away.
-- 4. share_presentation refuses a copy of a presentation QuizMatter hid ("Make a copy", then Publish, got around
--    the hide).
--
-- The database's own functions (publish_review, approve_submission, save_presentation's checks, share_presentation,
-- before_account_delete, …) still work: the guard only stops direct writes through the API, which run as the role
-- "authenticated". A security definer function runs as its owner, so its writes get past the guard, and those
-- functions check the caller themselves.

-- ─── 1. Presentations: who reads, changes and deletes ─────────────────────────────────────────────────────────
-- "Own presentations" (the owner does everything), "Read published presentations" and the restrictive "Only admins
-- save admin presentations" (only an admin's row can be from_admin) stay as they are.
drop policy "Admins manage every presentation" on public.presentations;

-- Every admin reads every presentation (Reports, reviews, submissions).
create policy "Admins read every presentation" on public.presentations
  for select to authenticated
  using ((select public.is_admin()));

-- The super admin may add, change and delete any presentation (Move to QuizMatter, sharing any QuizMatter one, …).
create policy "Super admin manages every presentation" on public.presentations
  for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

-- Every admin may update any presentation, but guard_admin_presentation_update (below) lets a plain admin change
-- only hidden_at on someone else's: hide or show it (Admin → Reports).
create policy "Admins hide any presentation" on public.presentations
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- True when the caller is an admin and the presentation, or its shared copy, is hidden or has a report. Reports and
-- hides are on a teacher's shared copy, but Reports → Delete deletes its original (the copy goes with it), so the
-- copy counts too. "security definer": the check reads presentations, and a policy on presentations that reads
-- presentations itself stops with "infinite recursion".
create function public.admin_may_delete(target_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() and exists (
    select 1 from public.presentations p
    where (p.id = target_id or p.shared_from = target_id)
      and (
        p.hidden_at is not null
        or exists (select 1 from public.presentation_reports r where r.presentation_id = p.id)
      )
  );
$$;

-- Used by the policy below, so signed-in users run it (it says false to anyone who isn't an admin).
revoke execute on function public.admin_may_delete(text) from public, anon;
grant execute on function public.admin_may_delete(text) to authenticated;

-- Every admin deletes someone else's presentation only when it (or its shared copy) is hidden or reported. Their own
-- go through "Own presentations"; the super admin's through "Super admin manages every presentation".
create policy "Admins delete reported or hidden presentations" on public.presentations
  for delete to authenticated
  using (public.admin_may_delete(id));

-- A second rule every delete must also pass ("restrictive"): a QuizMatter presentation is deleted only by an admin.
-- A former admin still owns theirs ("Own presentations"), but can't delete them. (The guard below also stops them
-- from turning from_admin off first.) Deleting an account isn't stopped: its rows go by cascade, which skips these
-- rules, after before_account_delete moved its QuizMatter presentations to the super admin.
create policy "Only admins delete QuizMatter presentations" on public.presentations
  as restrictive
  for delete to authenticated
  using (not from_admin or (select public.is_admin()));

-- ─── 2. The guard on direct updates ───────────────────────────────────────────────────────────────────────────
-- Only direct writes through the API (current_user = 'authenticated'). A security definer function runs as its owner,
-- so its own updates (publish_review, share_presentation, before_account_delete, …) get past. save_presentation runs
-- as the caller, but only ever changes the caller's own presentation.
-- For everyone but the super admin:
-- - owner_id and from_admin never change (Move to QuizMatter is the super admin's; a former admin can't turn
--   from_admin off to delete one);
-- - on someone else's presentation only hidden_at may change.
-- "security invoker": current_user must be the caller's role, not this function's owner.
-- Triggers of the same kind run in A–Z order, so this one sees what the caller sent before keep_copied_from and
-- set_editor_author change NEW themselves. The ones that run before it don't get in the way:
-- cap_presentation_data_version only lowers a version above the newest one; check_hidden_change and
-- count_share_clicks only refuse (or count a click).
create function public.guard_admin_presentation_update()
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
  return new;
end;
$$;

revoke execute on function public.guard_admin_presentation_update() from public, anon, authenticated;

create trigger guard_admin_presentation_update
  before update on public.presentations
  for each row execute function public.guard_admin_presentation_update();

-- ─── 3. Editors: the super admin gives the role, any admin takes it away ───────────────────────────────────────
-- Giving it removes the teacher's published copies (remove_new_editor_copies), with their bookmarks and reports.
-- No update rule: nobody changes a row (setEditor gives the role with "on conflict do nothing").
drop policy "Admins manage editors" on public.editors;

-- Taking the role away (setEditor's delete) needs to read the row too.
create policy "Admins read editors" on public.editors
  for select to authenticated
  using ((select public.is_admin()));

create policy "Super admin adds editors" on public.editors
  for insert to authenticated
  with check ((select public.is_super_admin()));

create policy "Admins remove editors" on public.editors
  for delete to authenticated
  using ((select public.is_admin()));

-- Never an admin or a banned teacher, whoever adds the row. "security definer" lets it read the admins table.
create function public.check_editor_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.admins a where a.user_id = new.user_id) then
    raise exception 'Admins can''t be editors.' using errcode = '42501';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = new.user_id) then
    raise exception 'Banned teachers can''t be editors.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_editor_target() from public, anon, authenticated;

create trigger check_editor_target
  before insert or update on public.editors
  for each row execute function public.check_editor_target();

-- ─── 4. share_presentation: same as before (20261210000000_data_version_cap.sql), plus the hidden source ──────
-- A teacher whose shared copy QuizMatter hid could "Make a copy" and publish that instead. Refused when the
-- presentation this one was copied from (copied_from), or that one's shared copy, is hidden.
-- "create or replace" keeps who may run it.
create or replace function public.share_presentation(target_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.presentations;
  copy_id text;
begin
  select * into original from public.presentations p where p.id = target_id for update;
  if not found or original.owner_id is distinct from auth.uid() or original.from_admin or original.shared_from is not null then
    raise exception 'You can only share your own presentations.' using errcode = '42501';
  end if;
  if public.is_editor() then
    raise exception 'Editors send presentations to QuizMatter instead of publishing them.' using errcode = '42501';
  end if;
  if original.hidden_at is not null then
    raise exception 'QuizMatter hid this presentation, so it can''t be shared.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.presentations p
    where (p.id = original.copied_from or p.shared_from = original.copied_from) and p.hidden_at is not null
  ) then
    raise exception 'QuizMatter hid the presentation this was copied from, so it can''t be shared.' using errcode = '42501';
  end if;
  if public.is_review_locked(target_id) then
    raise exception 'This presentation is waiting for QuizMatter.' using errcode = 'QMREV';
  end if;
  -- Same rule as publishableSchema in src/lib/schema.ts.
  if not public.has_publishable_content(target_id) then
    raise exception 'Add a title and some content before publishing.' using errcode = 'QMPUB';
  end if;

  select p.id into copy_id from public.presentations p where p.shared_from = target_id for update;
  perform public.count_click('share');
  if copy_id is null then
    perform public.count_click('publish');
  end if;

  -- Lets the shared copy triggers through for these changes only (until this transaction ends).
  perform set_config('quizmatter.sharing', 'yes', true);
  if copy_id is null then
    copy_id := gen_random_uuid()::text;
    insert into public.presentations (
      id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author,
      reference_links, tags, transition, transition_speed, is_published, from_admin, shared_from, shared_at,
      created_at, updated_at, data_version
    )
    values (
      copy_id, original.owner_id, original.title, original.description, original.grades, original.subject,
      original.term, original.week, original.day, original.curriculum, original.learning_competency, original.author,
      original.reference_links, original.tags, original.transition, original.transition_speed, true, false,
      target_id, now(), now(), now(), original.data_version
    );
  else
    -- Same id, created_at and hidden_at, so links, bookmarks, reports and an admin's hiding stay.
    update public.presentations p set
      title = original.title,
      description = original.description,
      grades = original.grades,
      subject = original.subject,
      term = original.term,
      week = original.week,
      day = original.day,
      curriculum = original.curriculum,
      learning_competency = original.learning_competency,
      author = original.author,
      reference_links = original.reference_links,
      tags = original.tags,
      transition = original.transition,
      transition_speed = original.transition_speed,
      data_version = original.data_version,
      shared_at = now(),
      updated_at = now()
    where p.id = copy_id;
    delete from public.slides s where s.presentation_id = copy_id;
  end if;
  insert into public.slides (presentation_id, id, position, data)
  select copy_id, s.id, s.position, s.data from public.slides s where s.presentation_id = target_id;
  perform set_config('quizmatter.sharing', '', true);

  return jsonb_build_object('id', copy_id, 'sharedAt', floor(extract(epoch from now()) * 1000)::bigint);
end;
$$;
