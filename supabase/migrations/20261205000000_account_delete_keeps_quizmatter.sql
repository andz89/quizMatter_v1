-- Deleting an account (from the Supabase dashboard) no longer takes shared QuizMatter work with it:
-- 1. An admin's QuizMatter presentations move to the super admin first, so teachers don't lose them. Deleting a
--    super admin who still owns some, with no other super admin to take them, is refused.
-- 2. An editor's approved submissions (receipts) stay, with an empty editor. Their other submissions go (a waiting
--    one would only stay stuck). The lesson then has no maker (lesson_editor): no week list, no author updates.
-- 3. A reviewer's "Reviewed by" rows stay on the live presentations (the name, email and date are saved in the
--    row), with an empty reviewer, so the name no longer links to a profile.

-- ─── 2. Approved receipts outlive their editor ───────────────────────────────────────────────────────────
alter table public.presentation_submissions alter column submitter_id drop not null;
alter table public.presentation_submissions drop constraint presentation_submissions_submitter_id_fkey;
alter table public.presentation_submissions
  add constraint presentation_submissions_submitter_id_fkey
  foreign key (submitter_id) references auth.users (id) on delete set null;

-- ─── 3. "Reviewed by" outlives its reviewer ──────────────────────────────────────────────────────────────
-- The reviewer can become empty, so it can't be part of the key anymore: the row gets its own id. Still one row
-- per reviewer per presentation (publish_review's "on conflict" needs it). Empty reviewers don't clash.
alter table public.presentation_reviewers add column id uuid not null default gen_random_uuid();
alter table public.presentation_reviewers drop constraint presentation_reviewers_pkey;
alter table public.presentation_reviewers add primary key (id);
alter table public.presentation_reviewers alter column reviewer_id drop not null;
alter table public.presentation_reviewers
  add constraint presentation_reviewers_presentation_id_reviewer_id_key unique (presentation_id, reviewer_id);
alter table public.presentation_reviewers drop constraint presentation_reviewers_reviewer_id_fkey;
alter table public.presentation_reviewers
  add constraint presentation_reviewers_reviewer_id_fkey
  foreign key (reviewer_id) references auth.users (id) on delete set null;

-- ─── 1 and 2. Before an account is deleted ───────────────────────────────────────────────────────────────
-- Runs before Postgres deletes the account's rows (its presentations go with it, "on delete cascade").
create function public.before_account_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  heir uuid;
begin
  if exists (select 1 from public.presentations p where p.owner_id = old.id and p.from_admin) then
    select a.user_id into heir from public.admins a where a.is_super and a.user_id <> old.id limit 1;
    if heir is null then
      raise exception 'This account owns QuizMatter presentations and there is no other super admin to take them.'
        using errcode = '42501';
    end if;
    -- A presentation under review still changes owner (the review lock lets publish_review's setting through),
    -- and the move isn't counted as anyone's writes.
    perform set_config('quizmatter.publishing_review', 'yes', true);
    perform set_config('quizmatter.write_counted', 'yes', true);
    update public.presentations set owner_id = heir where owner_id = old.id and from_admin;
    perform set_config('quizmatter.publishing_review', '', true);
    perform set_config('quizmatter.write_counted', '', true);
  end if;

  delete from public.presentation_submissions s where s.submitter_id = old.id and s.status <> 'approved';
  return old;
end;
$$;

revoke execute on function public.before_account_delete() from public, anon, authenticated;

create trigger before_account_delete
  before delete on auth.users
  for each row execute function public.before_account_delete();
