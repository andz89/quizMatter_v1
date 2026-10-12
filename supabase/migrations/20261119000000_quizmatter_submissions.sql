-- Submit to QuizMatter: an editor offers one of their own presentations; an admin approves it (QuizMatter gets
-- its own shared copy, the Author is still the editor) or sends it back with a note. While it waits, the original
-- is locked like a presentation under review. No Withdraw. Once approved it can't be submitted again.
-- Spec: docs/superpowers/specs/2026-10-12-quizmatter-submissions-design.md

-- ─── 1. The table ─────────────────────────────────────────────────────────────────────────────────────────
-- One row per presentation. No rules (row level security on, no policies): everything goes through the
-- functions below.
create table public.presentation_submissions (
  presentation_id text primary key references public.presentations (id) on delete cascade,
  submitter_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('submitted', 'sent_back', 'approved', 'canceled')),
  -- Same limit as REVIEW_NOTE_MAX_LENGTH in src/lib/schema.ts.
  admin_note text check (char_length(admin_note) <= 500),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  -- The QuizMatter copy, once approved.
  copy_id text references public.presentations (id) on delete set null
);

create index presentation_submissions_submitter_idx on public.presentation_submissions (submitter_id);

alter table public.presentation_submissions enable row level security;

-- ─── 2. The lock: same as before (20261022000000_review_fixes.sql), plus a waiting submission ────────────
-- Only while its submitter's account exists, so deleting an account never gets stuck on the lock.
create or replace function public.is_review_locked(target_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.presentation_reviews r
    where r.presentation_id = target_id and r.status in ('reviewing', 'submitted') and r.reviewer_id is not null
  ) or exists (
    select 1 from public.presentation_submissions s
    join auth.users u on u.id = s.submitter_id
    where s.presentation_id = target_id and s.status = 'submitted'
  );
$$;

-- ─── 3. Submit ────────────────────────────────────────────────────────────────────────────────────────────
create function public.submit_presentation(target_id text)
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

-- ─── 4. Approve: the copy, all in one step ─────────────────────────────────────────────────────────────────
create function public.approve_submission(target_id text)
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

-- ─── 5. Send back ─────────────────────────────────────────────────────────────────────────────────────────
create function public.send_back_submission(target_id text, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can send submissions back.' using errcode = '42501';
  end if;
  -- Same limits as reviewNoteSchema in src/lib/schema.ts.
  if char_length(trim(coalesce(note, ''))) not between 1 and 500 then
    raise exception 'The note isn''t valid.' using errcode = '22023';
  end if;
  update public.presentation_submissions set
    status = 'sent_back',
    admin_note = trim(note),
    decided_at = now(),
    decided_by = auth.uid()
  where presentation_id = target_id and status = 'submitted';
  if not found then
    raise exception 'This presentation isn''t waiting for QuizMatter anymore.' using errcode = 'QMSUB';
  end if;
end;
$$;

-- ─── 6. Reading ───────────────────────────────────────────────────────────────────────────────────────────
-- My submissions, newest first (the Reviews & submissions tab, and the status on my cards).
create function public.my_submissions()
returns table (presentation_id text, title text, status text, admin_note text, submitted_at timestamptz, copy_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.presentation_id, p.title, s.status, s.admin_note, s.submitted_at, s.copy_id
  from public.presentation_submissions s
  join public.presentations p on p.id = s.presentation_id
  where s.submitter_id = (select auth.uid())
  order by s.submitted_at desc;
$$;

-- Admins: the waiting ones, oldest first, with the editor's name and email.
create function public.admin_submissions()
returns table (presentation_id text, title text, editor_name text, editor_email text, submitted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.presentation_id,
    p.title,
    coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1)),
    u.email,
    s.submitted_at
  from public.presentation_submissions s
  join public.presentations p on p.id = s.presentation_id
  join auth.users u on u.id = s.submitter_id
  left join public.user_settings st on st.user_id = s.submitter_id
  where public.is_admin() and s.status = 'submitted'
  order by s.submitted_at;
$$;

-- One presentation's submission, for its owner or an admin. No row otherwise.
create function public.submission_status(target_id text)
returns table (status text, admin_note text, submitted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.status, s.admin_note, s.submitted_at
  from public.presentation_submissions s
  where s.presentation_id = target_id and (s.submitter_id = (select auth.uid()) or public.is_admin());
$$;

-- ─── 7. An editor removed: same as before (cancel their reviews), plus cancel their waiting submissions ──
create or replace function public.cancel_reviews_of_removed_editor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.cancel_review(r.presentation_id, true)
  from public.presentation_reviews r
  where r.reviewer_id = old.user_id and r.status in ('reviewing', 'submitted');
  update public.presentation_submissions set status = 'canceled', decided_at = now()
  where submitter_id = old.user_id and status = 'submitted';
  return old;
end;
$$;

-- ─── 8. Who may call them ─────────────────────────────────────────────────────────────────────────────────
revoke execute on function public.submit_presentation(text) from public, anon;
revoke execute on function public.approve_submission(text) from public, anon;
revoke execute on function public.send_back_submission(text, text) from public, anon;
revoke execute on function public.my_submissions() from public, anon;
revoke execute on function public.admin_submissions() from public, anon;
revoke execute on function public.submission_status(text) from public, anon;
grant execute on function public.submit_presentation(text) to authenticated;
grant execute on function public.approve_submission(text) to authenticated;
grant execute on function public.send_back_submission(text, text) to authenticated;
grant execute on function public.my_submissions() to authenticated;
grant execute on function public.admin_submissions() to authenticated;
grant execute on function public.submission_status(text) to authenticated;
