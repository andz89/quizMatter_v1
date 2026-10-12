-- Submissions as receipts: an approved submission stays in the editor's Reviews & submissions table even after
-- they delete their original, as long as QuizMatter's copy exists (it's traced by copy_id, not by the title).
-- The table shows the current title: the original's, else the copy's, else the one saved here at submit.
-- A sent-back or canceled submission goes away with its original (nothing is left to show).

-- ─── 1. Its own id; the original's id may become empty ────────────────────────────────────────────────────
alter table public.presentation_submissions add column id uuid not null default gen_random_uuid();
-- Same limit as DETAIL_MAX_LENGTH.title in src/lib/schema.ts.
alter table public.presentation_submissions add column title text not null default '' check (char_length(title) <= 120);

update public.presentation_submissions s set title = p.title
from public.presentations p
where p.id = s.presentation_id;

alter table public.presentation_submissions drop constraint presentation_submissions_pkey;
alter table public.presentation_submissions add primary key (id);
alter table public.presentation_submissions alter column presentation_id drop not null;
-- Still one submission per presentation (submit_presentation's "on conflict" needs it). Empty ids don't clash.
alter table public.presentation_submissions add constraint presentation_submissions_presentation_id_key unique (presentation_id);

-- Deleting the original empties the link instead of deleting the receipt.
alter table public.presentation_submissions drop constraint presentation_submissions_presentation_id_fkey;
alter table public.presentation_submissions
  add constraint presentation_submissions_presentation_id_fkey
  foreign key (presentation_id) references public.presentations (id) on delete set null;

-- ─── 2. Only approved receipts outlive their original ─────────────────────────────────────────────────────
-- "security definer": the table has no rules for teachers. A waiting one is left alone: this runs before the lock
-- trigger (same timing, names in A–Z order), which then refuses the delete. (When its editor's account is deleted,
-- the receipt goes with the account.)
create function public.drop_unapproved_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.presentation_submissions s
  where s.presentation_id = old.id and s.status in ('sent_back', 'canceled');
  return old;
end;
$$;

create trigger drop_unapproved_submission
  before delete on public.presentations
  for each row execute function public.drop_unapproved_submission();

-- ─── 3. submit_presentation: same as before (20261120000000_submission_fixes.sql), plus the title ─────────
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

  insert into public.presentation_submissions (presentation_id, submitter_id, status, title, submitted_at)
  values (target_id, auth.uid(), 'submitted', p.title, now())
  on conflict (presentation_id) do update set
    submitter_id = excluded.submitter_id,
    status = 'submitted',
    title = excluded.title,
    admin_note = null,
    submitted_at = now(),
    decided_at = null,
    decided_by = null;
end;
$$;

-- ─── 4. my_submissions: by receipt id, with the current title ─────────────────────────────────────────────
-- Its columns change, so it's dropped and made again.
drop function public.my_submissions();

create function public.my_submissions()
returns table (
  id uuid, presentation_id text, title text, status text, admin_note text, submitted_at timestamptz, copy_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.presentation_id, coalesce(p.title, c.title, s.title), s.status, s.admin_note, s.submitted_at, s.copy_id
  from public.presentation_submissions s
  left join public.presentations p on p.id = s.presentation_id
  left join public.presentations c on c.id = s.copy_id
  -- With both gone there's nothing to open, so it isn't shown.
  where s.submitter_id = (select auth.uid()) and (s.presentation_id is not null or s.copy_id is not null)
  order by s.submitted_at desc;
$$;

revoke execute on function public.my_submissions() from public, anon;
grant execute on function public.my_submissions() to authenticated;
