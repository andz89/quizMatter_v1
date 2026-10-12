-- Submissions follow-ups (after the final review of 20261119000000_quizmatter_submissions.sql):
-- 1. submit_presentation also refuses while a review round is open (QMSUB), as the spec says.
-- 2. approve_submission refuses a presentation an admin hid while it waited (QMHID), so it isn't shared.
-- Both are otherwise the same as before.

-- ─── 1. submit_presentation ───────────────────────────────────────────────────────────────────────────────
create or replace function public.submit_presentation(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.presentations;
  existing public.presentation_submissions;
begin
  if not public.is_editor() or public.is_banned() then
    raise exception 'Only editors can submit presentations to QuizMatter.' using errcode = '42501';
  end if;
  select * into p from public.presentations pr where pr.id = target_id and pr.owner_id = auth.uid() for update;
  if not found or p.from_admin or p.hidden_at is not null then
    raise exception 'This presentation can''t be submitted.' using errcode = 'QMSUB';
  end if;
  -- An open review round locks it too (only QuizMatter presentations have those, so this is a safety net).
  if public.is_review_locked(target_id) then
    raise exception 'This presentation is locked right now.' using errcode = 'QMSUB';
  end if;
  select * into existing from public.presentation_submissions s where s.presentation_id = target_id for update;
  if found and existing.status in ('submitted', 'approved') then
    raise exception 'This presentation is already waiting or already in QuizMatter.' using errcode = 'QMSUB';
  end if;
  if not public.has_publishable_content(target_id) then
    raise exception 'Add a title and some content before publishing.' using errcode = 'QMPUB';
  end if;

  insert into public.presentation_submissions (presentation_id, submitter_id, status, submitted_at)
  values (target_id, auth.uid(), 'submitted', now())
  on conflict (presentation_id) do update set
    submitter_id = excluded.submitter_id,
    status = 'submitted',
    admin_note = null,
    submitted_at = now(),
    decided_at = null,
    decided_by = null;
end;
$$;

-- ─── 2. approve_submission ────────────────────────────────────────────────────────────────────────────────
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
    -- Same limit as DETAIL_MAX_LENGTH.author in src/lib/schema.ts.
    left(coalesce(nullif(trim(p.author), ''), editor_name, ''), 120),
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
