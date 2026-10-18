-- Editors' Author and "Copied from".
-- 1. An editor's own presentations always have the editor as their Author (display name, or the part of the email
--    before "@", like submit_review): Make a copy, the editor, Claude's drafts — whatever is sent, the database sets it.
--    Approving their submission always uses the editor too (before, it kept whatever the Author field said, so a copy
--    of a QuizMatter lesson went back to QuizMatter as "Author: QuizMatter").
-- 2. Make a copy saves which presentation a copy came from (copied_from), so an admin deciding on a submission sees
--    "Copied from <title>" with a link. Set once, on the copy's first save; never changed after.
-- 3. One-time fix: presentations already approved, and editors' own presentations, get the editor as their Author.

-- ─── 1. Where a copy came from ────────────────────────────────────────────────────────────────────────────
-- No foreign key on purpose: when the original is deleted the id stays, so the admin page can say "a presentation
-- that was deleted" instead of showing nothing.
alter table public.presentations add column copied_from text;

-- On insert, only a presentation the saver can read (and not itself); on update, never changed.
-- "security invoker": the check sees only what the saver may read.
create function public.keep_copied_from()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.copied_from := old.copied_from;
  elsif new.copied_from is not null
    and (new.copied_from = new.id or not exists (select 1 from public.presentations p where p.id = new.copied_from)) then
    new.copied_from := null;
  end if;
  return new;
end;
$$;

create trigger keep_copied_from
  before insert or update on public.presentations
  for each row execute function public.keep_copied_from();

-- ─── 2. An editor's presentations: the editor is the Author ───────────────────────────────────────────────
-- Their own presentations only (not QuizMatter ones, which an editor never owns). "security definer" to read the
-- email from auth.users.
create function public.editor_author(user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Same limit as DETAIL_MAX_LENGTH.author in src/lib/schema.ts.
  select left(coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1), ''), 120)
  from auth.users u
  left join public.user_settings st on st.user_id = u.id
  where u.id = editor_author.user_id;
$$;
revoke execute on function public.editor_author(uuid) from public, anon, authenticated;

create function public.set_editor_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.from_admin and exists (select 1 from public.editors e where e.user_id = new.owner_id) then
    new.author := coalesce(public.editor_author(new.owner_id), '');
  end if;
  return new;
end;
$$;

create trigger set_editor_author
  before insert or update on public.presentations
  for each row execute function public.set_editor_author();

-- ─── 3. save_presentation: same as before (20261125000000_shared_copy_fixes.sql), plus copied_from ─────────
create or replace function public.save_presentation(presentation jsonb, slide_ids text[], base_updated_at bigint)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := presentation ->> 'id';
  saved_updated_at timestamptz;
  slide_count int := coalesce(cardinality(slide_ids), 0);
begin
  -- Same as MAX_SLIDES in src/lib/schema.ts. Every presentation has at least one slide.
  if slide_count = 0 or slide_count > 100 then
    raise exception 'A presentation needs 1 to 100 slides.' using errcode = '22023';
  end if;
  if (select count(distinct id) from unnest(slide_ids) as id) <> slide_count then
    raise exception 'A slide id is used twice.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(presentation -> 'slides') as slide where not (slide ->> 'id' = any (slide_ids))
  ) then
    raise exception 'A sent slide is missing from slide_ids.' using errcode = '22023';
  end if;
  -- Only an old app tab sends a teacher's presentation as published (today's app publishes with share_presentation).
  if not coalesce((presentation ->> 'fromAdmin')::boolean, false) and coalesce((presentation ->> 'isPublished')::boolean, false) then
    raise exception 'Reload the page to publish: publishing makes a shared copy now.' using errcode = '42501';
  end if;

  -- Locked until the save ends, so two saves of the same presentation can't cross.
  select p.updated_at into saved_updated_at from public.presentations p where p.id = target_id for update;
  if found and (base_updated_at is null or floor(extract(epoch from saved_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This presentation was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;

  insert into public.presentations (
    id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at, copied_from
  )
  values (
    target_id,
    presentation ->> 'title',
    presentation ->> 'description',
    public.grades_from(presentation),
    presentation ->> 'subject',
    -- An app tab opened before Term existed sends none: keep it empty.
    coalesce(presentation ->> 'term', ''),
    -- An app tab opened before Week and Day existed sends none: keep them empty.
    coalesce(presentation ->> 'week', ''),
    coalesce(presentation ->> 'day', ''),
    presentation ->> 'curriculum',
    presentation ->> 'learningCompetency',
    presentation ->> 'author',
    array(select jsonb_array_elements_text(presentation -> 'referenceLinks')),
    -- An app tab opened before tags existed sends none: keep it empty.
    array(select jsonb_array_elements_text(coalesce(presentation -> 'tags', '[]'))),
    -- An app tab opened before slide effects existed sends none: use the default.
    coalesce(presentation ->> 'transition', 'slide'),
    -- An app tab opened before effect speeds existed sends none: use the default.
    coalesce((presentation ->> 'transitionSpeed')::smallint, 3),
    -- A teacher's original is never published itself (its shared copy is).
    coalesce((presentation ->> 'fromAdmin')::boolean, false) and (presentation ->> 'isPublished')::boolean,
    coalesce((presentation ->> 'fromAdmin')::boolean, false),
    to_timestamp((presentation ->> 'createdAt')::bigint / 1000.0),
    now(),
    -- Make a copy sends where it was copied from (only on the first save; later saves never change it, see
    -- keep_copied_from). A teacher's other saves send none.
    nullif(presentation ->> 'copiedFrom', '')
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    grades = excluded.grades,
    subject = excluded.subject,
    term = excluded.term,
    week = excluded.week,
    day = excluded.day,
    curriculum = excluded.curriculum,
    learning_competency = excluded.learning_competency,
    author = excluded.author,
    reference_links = excluded.reference_links,
    tags = excluded.tags,
    transition = excluded.transition,
    transition_speed = excluded.transition_speed,
    -- from_admin isn't changed by a save, so the saved row says which kind it is.
    is_published = public.presentations.from_admin and (presentation ->> 'isPublished')::boolean,
    updated_at = now();

  delete from public.slides s where s.presentation_id = target_id and not (s.id = any (slide_ids));

  -- Unchanged slides: only their position, and only if it moved.
  update public.slides s set position = (t.ord - 1)::int
  from unnest(slide_ids) with ordinality as t(id, ord)
  where s.presentation_id = target_id and s.id = t.id and s.position <> t.ord - 1;

  insert into public.slides (presentation_id, id, position, data)
  select target_id, slide ->> 'id', array_position(slide_ids, slide ->> 'id') - 1, slide
  from jsonb_array_elements(presentation -> 'slides') as slide
  on conflict (presentation_id, id) do update set position = excluded.position, data = excluded.data;

  -- Every slide in the list must now be in the database. If one isn't (the app thought it was saved, but it
  -- isn't), nothing is saved and the app sends every slide instead.
  if (select count(*) from public.slides s where s.presentation_id = target_id) <> slide_count then
    raise exception 'Some slides are missing. Send every slide.' using errcode = 'QM422';
  end if;

  return floor(extract(epoch from now()) * 1000)::bigint;
end;
$$;

-- ─── 4. approve_submission: same as before (20261120000000_submission_fixes.sql), Author always the editor ─
create or replace function public.approve_submission(target_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.presentation_submissions;
  new_id text := gen_random_uuid()::text;
  editor_name text;
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
  -- Same as submit_review: display name, or the part of the email before "@".
  select coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1)) into editor_name
  from auth.users u
  left join public.user_settings st on st.user_id = u.id
  where u.id = s.submitter_id;

  -- The computed columns (tags_text, search_text) are left out: the database fills them in.
  insert into public.presentations (
    id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency,
    author, reference_links, tags, transition, transition_speed, is_published, from_admin
  )
  select
    new_id, auth.uid(), p.title, p.description, p.grades, p.subject, p.term, p.week, p.day, p.curriculum,
    p.learning_competency,
    -- Always the editor (never what the Author field says). Same limit as DETAIL_MAX_LENGTH.author in src/lib/schema.ts.
    left(coalesce(editor_name, ''), 120),
    p.reference_links, p.tags, p.transition, p.transition_speed, true, true
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

-- ─── 5. One-time fix ──────────────────────────────────────────────────────────────────────────────────────
-- Locked ones (waiting for QuizMatter, or under review) are skipped: the lock refuses changes, and a waiting one
-- gets the editor's name when it's approved.
update public.presentations p set author = public.editor_author(s.submitter_id)
from public.presentation_submissions s
where s.copy_id = p.id and s.status = 'approved' and not public.is_review_locked(p.id)
  and p.author is distinct from public.editor_author(s.submitter_id);

-- set_editor_author fills in the name.
update public.presentations p set author = p.author
where not p.from_admin and not public.is_review_locked(p.id)
  and exists (select 1 from public.editors e where e.user_id = p.owner_id)
  and p.author is distinct from public.editor_author(p.owner_id);
