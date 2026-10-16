-- Shared copy, moderation fixes (after 20261123000000_shared_copy.sql).
--
-- An admin's hide must stick. Before this, a teacher could click Private (the hidden copy and its reports were
-- deleted) and then Publish (a fresh, visible copy). Now:
-- - Private is refused while QuizMatter hides the copy, and so is deleting a hidden copy directly. Deleting the
--   original still deletes it (the original is gone first, then the copy goes by cascade).
-- - Publish is refused when the original itself is hidden.
-- - A shared copy can't be sent to QuizMatter (only the original can; a waiting copy would lock its original's
--   Update and delete).
-- - Editors don't publish to other teachers (they Submit to QuizMatter instead): share_presentation refuses them,
--   and giving someone the editor role removes their shared copies (today's editors' copies go now).
-- Reports → "Delete for good" on a copy deletes its original in the app (src/app/admin/reports/actions.ts).

-- ─── 0. Today's editors have no shared copies ─────────────────────────────────────────────────────────────────
delete from public.presentations p
where p.shared_from is not null and exists (select 1 from public.editors e where e.user_id = p.owner_id);

-- ─── 1. share_presentation: same as before (20261123000000_shared_copy.sql), refuses a hidden original and editors
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
      created_at, updated_at
    )
    values (
      copy_id, original.owner_id, original.title, original.description, original.grades, original.subject,
      original.term, original.week, original.day, original.curriculum, original.learning_competency, original.author,
      original.reference_links, original.tags, original.transition, original.transition_speed, true, false,
      target_id, now(), now(), now()
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

-- ─── 2. A hidden copy stays until an admin acts ───────────────────────────────────────────────────────────────
-- Covers Private (unshare_presentation deletes the copy) and a direct delete. Admins may delete it. When the
-- original is already gone (deleting it cascades to the copy), the copy goes too.
create function public.check_hidden_copy_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.shared_from is not null and old.hidden_at is not null and not public.is_admin()
    and exists (select 1 from public.presentations p where p.id = old.shared_from) then
    raise exception 'QuizMatter hid the shared copy, so it can''t be made private.' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger hidden_copy_delete
  before delete on public.presentations
  for each row execute function public.check_hidden_copy_delete();

-- ─── 3. A shared copy can't be sent to QuizMatter ─────────────────────────────────────────────────────────────
create function public.check_submission_not_copy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.presentations p where p.id = new.presentation_id and p.shared_from is not null) then
    raise exception 'Send the presentation itself, not its shared copy.' using errcode = 'QMSUB';
  end if;
  return new;
end;
$$;

create trigger submission_not_copy
  before insert on public.presentation_submissions
  for each row execute function public.check_submission_not_copy();

-- ─── 4. A new editor's shared copies go ───────────────────────────────────────────────────────────────────────
-- Editors never have published presentations (other teachers lose these copies, with their bookmarks and reports).
-- Their originals stay. Only an admin gives the role, so hidden copies may go too (check_hidden_copy_delete).
create function public.remove_new_editor_copies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.presentations p where p.owner_id = new.user_id and p.shared_from is not null;
  return null;
end;
$$;

revoke execute on function public.remove_new_editor_copies() from public, anon;

create trigger remove_new_editor_copies
  after insert on public.editors
  for each row execute function public.remove_new_editor_copies();
