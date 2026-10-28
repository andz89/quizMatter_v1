-- Author link: the Author of an editor's presentations follows their display name.
-- Before, the Author was only text, written once: on an editor's own presentation at each save, and on the QuizMatter
-- lesson made from their submission when it was approved. A later name change never reached it, so a lesson kept the
-- editor's old name for good.
-- 1. presentations.author_id: the editor a presentation belongs to as its Author. Set on an editor's own
--    presentations (each save, while they're an editor) and on the lesson approve_submission makes. Teachers'
--    presentations and copies leave it empty: their Author is free text (a book, another teacher…). Only the
--    database sets it; a direct write through the API can't (keep_author_id).
-- 2. While it's set, the Author is always that editor's name (set_editor_author), whatever is sent, so admins can't
--    retype it either.
-- 3. set_display_name also writes the new name on every presentation linked to the editor, in the same step. The
--    review lock lets that one change through. updated_at stays, so an open tab's next save doesn't conflict.
-- Deleting the editor's account empties author_id (on delete set null); the last name stays as text.

-- ─── 1. The link ──────────────────────────────────────────────────────────────────────────────────────────────
alter table public.presentations add column author_id uuid references auth.users (id) on delete set null;

-- The rename and an account delete find the editor's presentations by it.
create index presentations_author_id_idx on public.presentations (author_id) where author_id is not null;

-- A direct write (or save_presentation, which runs as the caller) never sets or changes the link: a new row starts
-- without one, a changed row keeps its own. The database's own functions (security definer) and cascades pass.
-- Runs before set_editor_author (triggers of the same kind run in name order), which then links an editor's own.
create function public.keep_author_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.author_id := null;
    else
      new.author_id := old.author_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger keep_author_id
  before insert or update on public.presentations
  for each row execute function public.keep_author_id();

-- ─── 2. set_editor_author: same as before (20261201000000_editor_author_and_copy_source.sql), now by the link ──
-- An editor's own presentation is linked to them; once they aren't an editor, its next save unlinks it (their Author
-- box opens again). A QuizMatter lesson keeps its link. While linked, the Author is the editor's name.
create or replace function public.set_editor_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.from_admin then
    new.author_id := case
      when exists (select 1 from public.editors e where e.user_id = new.owner_id) then new.owner_id
    end;
  end if;
  if new.author_id is not null then
    new.author := coalesce(public.editor_author(new.author_id), new.author);
  end if;
  return new;
end;
$$;

-- ─── 3. approve_submission: same as before (20261209000000_data_version.sql), plus the link ───────────────────
create or replace function public.approve_submission(target_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.presentation_submissions;
  new_id text := gen_random_uuid()::text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve submissions.' using errcode = '42501';
  end if;
  -- "for update": a second Approve (another tab) waits here, then finds it approved.
  select * into s from public.presentation_submissions sub where sub.presentation_id = target_id for update;
  if not found or s.status is distinct from 'submitted' then
    raise exception 'This presentation isn''t waiting for QuizMatter anymore.' using errcode = 'QMSUB';
  end if;
  -- An admin hid it (Admin → Reports) while it waited: hiding gets through the lock, but it mustn't be published.
  if exists (select 1 from public.presentations p where p.id = target_id and p.hidden_at is not null) then
    raise exception 'This presentation is hidden, so it can''t be approved.' using errcode = 'QMHID';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = s.submitter_id) then
    raise exception 'This editor is banned, so their presentation can''t be approved.' using errcode = 'QMBRV';
  end if;

  -- The computed columns (tags_text, search_text) are left out: the database fills them in.
  insert into public.presentations (
    id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency,
    author, author_id, reference_links, tags, transition, transition_speed, is_published, from_admin, data_version
  )
  select
    new_id, auth.uid(), p.title, p.description, p.grades, p.subject, p.term, p.week, p.day, p.curriculum,
    p.learning_competency,
    -- Always the editor (never what the Author field says), and linked to them, so a rename reaches it.
    coalesce(public.editor_author(s.submitter_id), ''), s.submitter_id,
    p.reference_links, p.tags, p.transition, p.transition_speed, true, true,
    -- The copy has the same slides, so the same version.
    p.data_version
  from public.presentations p
  where p.id = target_id;

  -- Slide ids stay: they only have to be unique inside their own presentation. sync_slide_photos fills
  -- slide_photos for the copy, so the weekly photo cleanup keeps its photos.
  insert into public.slides (presentation_id, id, position, data)
  select new_id, sl.id, sl.position, sl.data
  from public.slides sl
  where sl.presentation_id = target_id;

  update public.presentation_submissions set
    status = 'approved',
    copy_id = new_id,
    decided_at = now(),
    decided_by = auth.uid()
  where presentation_id = target_id;
  return new_id;
end;
$$;

-- ─── 4. check_presentation_review_lock: same as before (20261118000000_presentation_term.sql), plus the link ──
-- author_id is never compared: only the database changes it (an account delete empties it, even on a locked
-- lesson). The Author isn't compared while set_display_name writes a rename (quizmatter.renaming_author).
create or replace function public.check_presentation_review_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- tags_text and search_text are worked out by the database (null in NEW here), so they're left out of the comparison.
  ignored text[] := array['hidden_at', 'tags_text', 'search_text', 'author_id']
    || case when coalesce(current_setting('quizmatter.renaming_author', true), '') = 'yes' then array['author'] else '{}' end;
begin
  if coalesce(current_setting('quizmatter.publishing_review', true), '') = 'yes' or not public.is_review_locked(old.id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - ignored) = (to_jsonb(old) - ignored) then
    return new;
  end if;
  raise exception 'This presentation is under review.' using errcode = 'QMREV';
end;
$$;

-- ─── 5. set_display_name: same as before (20261122000000_super_admin.sql), plus the rename of linked Authors ──
-- Keep 30 days the same as DISPLAY_NAME_CHANGE_DAYS in userSettings.ts.
create or replace function public.set_display_name(name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_name text := trim(coalesce(name, ''));
  current_name text;
  changed_at timestamptz;
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;

  perform public.count_click('display_name');

  select s.display_name, s.display_name_changed_at into current_name, changed_at
  from public.user_settings s
  where s.user_id = me;

  -- Nothing to change: no wait starts.
  if new_name = coalesce(current_name, '') then
    return jsonb_build_object('status', 'saved');
  end if;

  if not public.is_super_admin() and changed_at > now() - interval '30 days' then
    return jsonb_build_object(
      'status', 'wait',
      'until', (extract(epoch from changed_at + interval '30 days') * 1000)::bigint
    );
  end if;

  if new_name <> '' and not public.claim_display_name(public.profile_slug(new_name), me) then
    return jsonb_build_object('status', 'taken');
  end if;

  -- Lets the guard below through, for this transaction only.
  perform set_config('qm.set_display_name', 'on', true);
  begin
    insert into public.user_settings as s (user_id, display_name, display_name_changed_at, updated_at)
    values (me, new_name, now(), now())
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      display_name_changed_at = excluded.display_name_changed_at,
      updated_at = excluded.updated_at;
  exception when unique_violation then
    -- Someone took it at the same moment.
    return jsonb_build_object('status', 'taken');
  end;

  -- The new name goes on every presentation linked to me (my own and my QuizMatter lessons), even one under review
  -- (the lock lets this through). updated_at stays, so an open tab's next save doesn't conflict.
  perform set_config('quizmatter.renaming_author', 'yes', true);
  update public.presentations p set author = public.editor_author(me) where p.author_id = me;
  perform set_config('quizmatter.renaming_author', '', true);

  return jsonb_build_object('status', 'saved');
end;
$$;
