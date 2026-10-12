# Submit to QuizMatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editors submit their own presentations to QuizMatter; an admin approves (QuizMatter gets its own shared
copy, Author = the editor) or sends it back with a note; the original is locked while it waits.

**Architecture:** One migration adds `presentation_submissions` (one row per presentation, no table rules) and the
database functions that hold every rule (`submit_presentation`, `approve_submission`, `send_back_submission`,
`my_submissions`, `admin_submissions`, `submission_status`). The lock reuses `is_review_locked`, so the existing
lock triggers refuse changes. The app calls them through server actions (zod first), shows the status on cards,
the view page, the editor, the renamed "Reviews & submissions" tab (two tables), and new admin pages.

**Tech Stack:** Next.js (App Router, server actions), Supabase (Postgres, RPC), zod, sonner, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-12-quizmatter-submissions-design.md`

## Global Constraints

- Only editors (`is_editor()`, not banned) submit, only their own saved, non-QuizMatter, non-hidden presentation
  with a title and content (`has_publishable_content`, error `QMPUB`).
- No Withdraw. Statuses: `submitted`, `sent_back`, `approved`, `canceled`. Approved can't be submitted again (`QMSUB`).
- Approve: one SQL function, all or nothing: copy `from_admin = true`, `is_published = true`, `owner_id` = approving
  admin, `author` = original's author or the editor's name (display name, or email before "@"), max 120 chars
  (`DETAIL_MAX_LENGTH.author`). Banned submitter → `QMBRV`.
- Note: 1–500 characters, `reviewNoteSchema` / `REVIEW_NOTE_MAX_LENGTH` (500).
- zod before every RPC (CLAUDE.md "Saving Data"). Every action shows a sonner toast on success and failure.
- One `Spinner`, one `TopLoadingBar`, `LinkPending` in links. Design system classes only; Lucide icons with `size`.
- Labels (same everywhere): submitted "Waiting for QuizMatter" grey (`bg-bg-page text-text-secondary`), sent_back
  "Sent back" Sunny (`bg-highlight-soft text-highlight-strong`), approved "In QuizMatter" Mint
  (`bg-success-soft text-success-strong`), canceled "Canceled" Coral (`bg-danger-soft text-danger-strong`, tables only).
- Home tab renamed "Reviews & submissions", path `/reviews` → `/reviews-submissions`.
- No new packages. No test runner in this repo: checks are SQL checks through the Supabase MCP, `npx tsc --noEmit`,
  `npm run lint`. Live testing is the user's.
- Supabase project id: `zmmkqncfbjkmwfyngaha`. Work on main; commit after each task; don't push.

## Review Focus

1. Deleting an editor's whole account while a submission waits must not get stuck on the lock → the lock only counts
   when the submitter still exists in `auth.users` (Task 1, SQL check step).
2. Admin approves twice at once (two tabs) → only one copy; the second gets `QMSUB` (`for update` row lock, Task 1).
3. Editor opens the edit page of a waiting presentation from an old tab/bookmark → sent to the view page, no editor
   (Task 4). A save from an editor tab opened before submitting → refused with the `QMREV` words (Task 2).
4. Photos in the copy survive the weekly cleanup → `slide_photos` rows exist for the copy (Task 1, SQL check).
5. Editor role taken away while waiting → status `canceled`, original unlocked (Task 1, SQL check).

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261119000000_quizmatter_submissions.sql`

**Interfaces:**
- Produces RPCs: `submit_presentation(target_id text) → void`; `approve_submission(target_id text) → text` (the
  copy's id); `send_back_submission(target_id text, note text) → void`; `my_submissions() → (presentation_id, title,
  status, admin_note, submitted_at, copy_id)`; `admin_submissions() → (presentation_id, title, editor_name,
  editor_email, submitted_at)`; `submission_status(target_id text) → (status, admin_note, submitted_at)`.
  Error codes: `QMSUB` (can't submit / not waiting), `QMPUB` (no content), `QMBRV` (submitter banned), `42501`.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply it** with the Supabase MCP `apply_migration` (project `zmmkqncfbjkmwfyngaha`, name
  `quizmatter_submissions`, the file's SQL). Expected: success.

- [ ] **Step 3: Check it with SQL** (Supabase MCP `execute_sql`), in one transaction that is rolled back, so no data
  stays. Pick a real editor id and one of their non-admin presentations with content
  (`select e.user_id, p.id from editors e join presentations p on p.owner_id = e.user_id and not p.from_admin limit 1`),
  and an admin id (`select user_id from admins limit 1`, or however `is_admin()` reads it). Then:

```sql
begin;
-- as the editor
select set_config('request.jwt.claims', json_build_object('sub', '<editor id>', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.submit_presentation('<presentation id>');
select public.is_review_locked('<presentation id>');            -- expect true
update public.presentations set title = title || ' x' where id = '<presentation id>';  -- expect error QMREV
select public.submit_presentation('<presentation id>');           -- expect error QMSUB
rollback;
```

Then the same `begin; …` as the editor to submit, `reset role;` and switch the claims to the admin, `set local role
authenticated;`, `select public.approve_submission('<presentation id>') as copy_id;`, then
`select from_admin, is_published, owner_id, author from presentations where id = '<copy id>'` (expect true, true,
admin, the author), `select count(*) from slides where presentation_id = '<copy id>'` (same as the original),
`select count(*) from slide_photos where presentation_id = '<copy id>'` (same as the original's),
`select public.approve_submission('<presentation id>')` (expect `QMSUB`), `rollback;`.
And: submit as the editor, then as postgres `delete from editors where user_id = '<editor id>'`, then
`select status from presentation_submissions where presentation_id = '<presentation id>'` (expect `canceled`), `rollback;`.
If any check fails, fix the migration, apply the fix as a new `create or replace` migration step, and check again.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261119000000_quizmatter_submissions.sql
git commit -m "Submissions migration: editors submit presentations to QuizMatter"
```

---

### Task 2: Shared helpers and server actions

**Files:**
- Create: `src/lib/submissions.ts`
- Modify: `src/app/actions.ts` (add `submitToQuizMatter`)
- Modify: `src/app/admin/presentations/actions.ts` (add `approveSubmission`, `sendBackSubmission`)
- Modify: `src/lib/presentations.ts:30` (`QMREV` words)

**Interfaces:**
- Produces: `SubmissionStatus`, `SUBMISSION_LABELS`, `MySubmission`, `loadMySubmissions(supabase)`,
  `loadSubmissionStatus(supabase, id)` from `@/lib/submissions`; `submitToQuizMatter(id): Promise<string | null>`
  from `src/app/actions.ts`; `approveSubmission(id): Promise<string | null>`, `sendBackSubmission(id, note):
  Promise<string | null>` from `src/app/admin/presentations/actions.ts` (an error message, or null when it worked).

- [ ] **Step 1: Write `src/lib/submissions.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** A presentation sent to QuizMatter (see the quizmatter_submissions migration). */
export type SubmissionStatus = "submitted" | "sent_back" | "approved" | "canceled";

// The same words and colors on cards, tables and the view page.
export const SUBMISSION_LABELS: Record<SubmissionStatus, { label: string; className: string }> = {
  submitted: { label: "Waiting for QuizMatter", className: "bg-bg-page text-text-secondary" },
  sent_back: { label: "Sent back", className: "bg-highlight-soft text-highlight-strong" },
  approved: { label: "In QuizMatter", className: "bg-success-soft text-success-strong" },
  canceled: { label: "Canceled", className: "bg-danger-soft text-danger-strong" },
};

export type MySubmission = {
  presentationId: string;
  title: string;
  status: SubmissionStatus;
  adminNote: string;
  submittedAt: number;
  // The QuizMatter copy, once approved (null if it was deleted since).
  copyId: string | null;
};

type MySubmissionRow = {
  presentation_id: string;
  title: string;
  status: SubmissionStatus;
  admin_note: string | null;
  submitted_at: string;
  copy_id: string | null;
};

/** My submissions, newest first. Throws if the lookup fails. */
export async function loadMySubmissions(supabase: SupabaseClient): Promise<MySubmission[]> {
  const { data, error } = await supabase.rpc("my_submissions");
  if (error) throw error;
  return (data as MySubmissionRow[]).map((row) => ({
    presentationId: row.presentation_id,
    title: row.title,
    status: row.status,
    adminNote: row.admin_note ?? "",
    submittedAt: Date.parse(row.submitted_at),
    copyId: row.copy_id,
  }));
}

/** One presentation's submission (its owner or an admin), or null. Throws if the lookup fails. */
export async function loadSubmissionStatus(
  supabase: SupabaseClient,
  id: string,
): Promise<{ status: SubmissionStatus; adminNote: string; submittedAt: number } | null> {
  const { data, error } = await supabase
    .rpc("submission_status", { target_id: id })
    .maybeSingle<{ status: SubmissionStatus; admin_note: string | null; submitted_at: string }>();
  if (error) throw error;
  if (!data) return null;
  return { status: data.status, adminNote: data.admin_note ?? "", submittedAt: Date.parse(data.submitted_at) };
}
```

- [ ] **Step 2: Add `submitToQuizMatter` at the end of `src/app/actions.ts`** (add `PUBLISH_NEEDS_CONTENT` to the
  `@/lib/schema` import):

```ts
/**
 * An editor sends one of their own presentations to QuizMatter (see the quizmatter_submissions migration): it's
 * locked until an admin approves it or sends it back. An error message, or null.
 */
export async function submitToQuizMatter(id: string): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = z.string().min(1).max(100).safeParse(id);
  if (!parsed.success) return "Couldn't submit the presentation. Please try again.";
  if (!(await getAccount()).isEditor) return "Only editors can submit presentations to QuizMatter.";

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_presentation", { target_id: parsed.data });
  refresh();
  if (error?.code === "QMPUB") return PUBLISH_NEEDS_CONTENT;
  if (error?.code === "QMSUB") return "This presentation is already waiting for QuizMatter, or already in QuizMatter.";
  return error ? "Couldn't submit the presentation. Please try again." : null;
}
```

- [ ] **Step 3: Add to `src/app/admin/presentations/actions.ts`** (next to `sendBackReview`; reuse its
  `idSchema` and `sendBackSchema`):

```ts
/** Approves a submitted presentation: QuizMatter gets its own shared copy (Author = the editor). An error, or null. */
export async function approveSubmission(id: string): Promise<string | null> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || !(await getAccount()).isAdmin) return "Only admins can approve submissions.";

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_submission", { target_id: parsed.data });
  refresh();
  if (error?.code === "QMSUB") return "This presentation isn't waiting for QuizMatter anymore.";
  if (error?.code === "QMBRV") return "This editor is banned, so their presentation can't be approved. Send it back instead.";
  return error ? "Couldn't approve the presentation. Please try again." : null;
}

/** Sends a submitted presentation back to its editor with a note; it unlocks. An error message, or null. */
export async function sendBackSubmission(id: string, note: string): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = sendBackSchema.safeParse({ id, note });
  if (!parsed.success) return parsed.error.issues[0].message;
  if (!(await getAccount()).isAdmin) return "Only admins can send submissions back.";

  const supabase = await createClient();
  const { error } = await supabase.rpc("send_back_submission", { target_id: parsed.data.id, note: parsed.data.note });
  refresh();
  if (error?.code === "QMSUB") return "This presentation isn't waiting for QuizMatter anymore.";
  return error ? "Couldn't send the presentation back. Please try again." : null;
}
```

- [ ] **Step 4: `QMREV` words** in `src/lib/presentations.ts`, keeping the comment above it:

```ts
  // Presentation reviews and submissions (see the presentation_reviews and quizmatter_submissions migrations).
  QMREV: "This presentation is under review or waiting for QuizMatter, so it can't be changed right now. Copy anything you need before leaving.",
```

- [ ] **Step 5:** `npx tsc --noEmit` and `npm run lint`. Expected: no errors.
- [ ] **Step 6: Commit** — `git add src/lib/submissions.ts src/app/actions.ts src/app/admin/presentations/actions.ts src/lib/presentations.ts` and `git commit -m "Submissions: helpers and server actions"`.

---

### Task 3: Status and "Submit to QuizMatter" on my cards

**Files:**
- Modify: `src/app/(home)/cards.ts` (`myCard`)
- Modify: `src/app/(home)/page.tsx`, `src/app/(home)/search/page.tsx` (load my submissions)
- Modify: `src/app/PresentationCard.tsx` (fields + label)
- Modify: `src/app/PresentationCardMenu.tsx` (menu item, no Edit/Delete while waiting)

**Interfaces:**
- Consumes: `loadMySubmissions`, `SubmissionStatus` (Task 2), `submitToQuizMatter` (Task 2).
- Produces: `PresentationCardData.submission?: SubmissionStatus`, `PresentationCardData.canSubmit?: boolean`;
  `myCard(p, isAdmin, now, extra: { isEditor: boolean; submission?: SubmissionStatus })`.

- [ ] **Step 1: `myCard`** in `cards.ts` (import `type SubmissionStatus` from `@/lib/submissions`):

```ts
/**
 * My own presentation as a card: opens the editor; shows Published / Hidden, and its QuizMatter submission.
 * Editors may submit it unless it's waiting or already approved (see the quizmatter_submissions migration).
 */
export function myCard(p: CardPresentation, isAdmin: boolean, now: number, extra: { isEditor: boolean; submission?: SubmissionStatus }) {
  return {
    ...toCard(p, `/presentation/${p.id}/edit`, now),
    // Hidden by an admin: other teachers can't see it, even if it's published.
    badge: p.hidden_at ? ("hidden" as const) : p.is_published ? ("published" as const) : undefined,
    canMoveToQuizMatter: isAdmin,
    submission: extra.submission,
    canSubmit: extra.isEditor && !p.hidden_at && extra.submission !== "submitted" && extra.submission !== "approved",
    createdAt: Date.parse(p.created_at),
    updatedAt: Date.parse(p.updated_at),
  };
}
```

- [ ] **Step 2: `page.tsx`**: add `loadMySubmissions(supabase)` to the `Promise.all` (editors only:
  `account.isEditor ? loadMySubmissions(supabase) : []`), build
  `const submissionOf = new Map(submissions.map((s) => [s.presentationId, s.status]));`, and change
  `buildMyCards(mine, drafts, isAdmin)` to `buildMyCards(mine, drafts, account, submissionOf)` with
  `myCard(presentation, account.isAdmin, now, { isEditor: account.isEditor, submission: submissionOf.get(presentation.id) })`.
  Its parameter type: `account: { isAdmin: boolean; isEditor: boolean }`, `submissionOf: Map<string, SubmissionStatus>`.
  Do the same in `search/page.tsx`'s `buildMineCards` (load the submissions only when `isMine && account.isEditor`).
  A former editor (role taken away) gets no labels and no Submit; that's fine.

- [ ] **Step 3: `PresentationCard.tsx`**: in `PresentationCardData` add

```ts
  // Sent to QuizMatter (see the quizmatter_submissions migration): a second label next to the status.
  submission?: SubmissionStatus;
  // Adds "Submit to QuizMatter" to the ⋮ menu (an editor's own presentation, not waiting or approved).
  canSubmit?: boolean;
```

  and replace `{card.badge && <Kicker badge={card.badge} />}` with a row of both labels. Canceled shows no card
  label (it's unlocked and can be submitted again):

```tsx
        {(card.badge || (card.submission && card.submission !== "canceled")) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {card.badge && <Kicker badge={card.badge} />}
            {card.submission && card.submission !== "canceled" && (
              <span className={`text-[11px] leading-none font-semibold tracking-[0.06em] uppercase ${SUBMISSION_KICKERS[card.submission]}`}>
                {SUBMISSION_LABELS[card.submission].label}
              </span>
            )}
          </div>
        )}
```

  with, next to `KICKERS`:

```ts
// The submission label's text color (like KICKERS: dark shades, so the small text reads well).
const SUBMISSION_KICKERS: Record<Exclude<SubmissionStatus, "canceled">, string> = {
  submitted: "text-text-secondary",
  sent_back: "text-highlight-strong",
  approved: "text-success-strong",
};
```

- [ ] **Step 4: `PresentationCardMenu.tsx`**: import `submitToQuizMatter` from `./actions`. Add:

```ts
  const isWaiting = card.submission === "submitted";

  const submit = async () => {
    setIsOpen(false);
    const question = `Send "${card.title}" to QuizMatter? An admin will check it. Until they decide, you can't change or delete it. If they approve it, QuizMatter gets its own copy, shared with every teacher, with you as the Author.`;
    if (!confirm(question)) return;
    setIsBusy(true);
    // On success the page reloads its list and the card says "Waiting for QuizMatter".
    const error = await submitToQuizMatter(card.id);
    setIsBusy(false);
    if (error) toast.error(error);
    else toast.success("Sent to QuizMatter. You'll see their answer in Reviews & submissions.");
  };
```

  Hide Edit while waiting (`card.badge !== "checking" && !isWaiting`), hide Delete while waiting (`{!isWaiting && (… Delete button …)}`),
  and add after "Move to QuizMatter":

```tsx
          {card.canSubmit && (
            <button type="button" onClick={submit} className={itemClass}>
              {card.submission === "sent_back" ? "Submit again" : "Submit to QuizMatter"}
            </button>
          )}
```

  Update the component's comment: "Editors also get "Submit to QuizMatter" (see canSubmit); while it waits there's no Edit or Delete."

- [ ] **Step 5:** `npx tsc --noEmit` and `npm run lint`. Expected: no errors.
- [ ] **Step 6: Commit** — `git commit -m "Submissions: status labels and Submit on my cards"` (the five files).

---

### Task 4: The lock on the edit page, the view page, and the editor's note

**Files:**
- Modify: `src/lib/fetchPresentation.ts` (add `submission`)
- Modify: `src/app/presentation/[id]/edit/page.tsx`
- Modify: `src/app/presentation/[id]/page.tsx`, `src/app/presentation/[id]/PresentationPreview.tsx`
- Modify: `src/app/presentation/[id]/edit/PresentationEditor.tsx`, `src/components/editor/Editor.tsx`

**Interfaces:**
- Consumes: `loadSubmissionStatus`, `SUBMISSION_LABELS` (Task 2).
- Produces: `fetchPresentation(id)` result gains `submission: { status; adminNote; submittedAt } | null`;
  `PresentationEditor` / `Editor` gain `sentBackNote?: string`.

- [ ] **Step 1: `fetchPresentation.ts`**: add `loadSubmissionStatus(supabase, id).catch(() => null)` to the first
  `Promise.all` (comment: "If it fails, the page opens without it; the database still enforces the lock."), add
  `submission: Awaited<ReturnType<typeof loadSubmissionStatus>>;` to the return type and `submission` to the result.

- [ ] **Step 2: edit page**: before the `result.isMine && !result.review.isLocked` line:

```ts
  // Waiting for QuizMatter: locked, so its owner gets the view page (it says why).
  if (result.isMine && result.submission?.status === "submitted") redirect(`/presentation/${id}`);
```

  and the editor line becomes:

```tsx
  if (result.isMine && !result.review.isLocked) {
    // Sent back: the admin's note shows under the top bar.
    const sentBackNote = result.submission?.status === "sent_back" ? result.submission.adminNote : undefined;
    return <PresentationEditor presentation={result.presentation} sentBackNote={sentBackNote} />;
  }
```

- [ ] **Step 3: `PresentationEditor.tsx` and `Editor.tsx`**: add the `sentBackNote?: string` prop, passed through.
  In `Editor.tsx`, under `<ReviewBanner />`:

```tsx
      {/* My presentation that QuizMatter sent back (see the quizmatter_submissions migration). */}
      {sentBackNote && (
        <p className="shrink-0 border-b border-border-default bg-highlight-soft px-4 py-2 text-sm text-text-primary">
          QuizMatter sent this back: {sentBackNote} Save your changes, then submit it again from its card&apos;s ⋮ menu.
        </p>
      )}
```

- [ ] **Step 4: view page**: `page.tsx` passes `submission={result.submission}` to `PresentationPreview`. In
  `PresentationPreview.tsx` add the prop (`submission: { status: SubmissionStatus; adminNote: string; submittedAt: number } | null`),
  `const isWaiting = isMine && submission?.status === "submitted";`, and next to the "Under review" label:

```tsx
            {isWaiting && (
              <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${SUBMISSION_LABELS.submitted.className}`}>
                {SUBMISSION_LABELS.submitted.label}
              </span>
            )}
```

  The Edit link's condition becomes `!review.isLocked && !isWaiting`. Under the buttons row (before `<header>`):

```tsx
        {isWaiting && (
          <p className="mt-3 text-sm text-text-secondary">
            You sent this to QuizMatter {timeAgo(submission.submittedAt, Date.now()).toLowerCase()}. You can change it again
            once an admin decides.
          </p>
        )}
```

  (`timeAgo` from `@/lib/format`; "Just now" → "just now". If TypeScript can't narrow `submission` there, use
  `submission!`.) Update the component comment: "While my presentation waits for QuizMatter, it has no Edit."

- [ ] **Step 5:** `npx tsc --noEmit` and `npm run lint`. Expected: no errors.
- [ ] **Step 6: Commit** — `git commit -m "Submissions: locked view page and sent-back note in the editor"`.

---

### Task 5: "Reviews & submissions" tab with two tables

**Files:**
- Move: `src/app/(home)/reviews/` → `src/app/(home)/reviews-submissions/` (`git mv`, includes `page.tsx` and any `loading.tsx`)
- Modify: `src/app/(home)/reviews-submissions/page.tsx`
- Modify: `src/app/MyReviews.tsx` (`ReviewRows` → `ReviewsTable`)
- Create: `src/app/MySubmissions.tsx` (`SubmissionsTable`)
- Modify: `src/app/(home)/HomeTabs.tsx`, `src/app/(home)/layout.tsx` (label, path, count)
- Modify: `CLAUDE.md` (Presentation Reviews section + a short Submissions section)

**Interfaces:**
- Consumes: `loadMySubmissions`, `MySubmission`, `SUBMISSION_LABELS` (Task 2).
- Produces: `ReviewsTable({ rows: MyReviewRow[] })`, `SubmissionsTable({ rows: MySubmission[] })`.

- [ ] **Step 1: Move the folder**: `git mv "src/app/(home)/reviews" "src/app/(home)/reviews-submissions"`, then
  `grep -rn '"/reviews"\|/reviews\b' src` and update every home-tab link (not `/admin/presentations/reviews`).

- [ ] **Step 2: `ReviewsTable`** in `MyReviews.tsx`, replacing `ReviewRows` (same status logic, now a table):

```tsx
/**
 * An editor's reviews in the Reviews & submissions tab, as a table: open ones and canceled ones (until someone
 * starts a new round). The title opens its page (Continue review is there).
 */
export function ReviewsTable({ rows }: { rows: MyReviewRow[] }) {
  return (
    // Scrolls sideways on narrow phones instead of breaking the page.
    <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
          <tr className="border-b border-border-default">
            <th className="px-5 py-2.5">Presentation</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-5 py-2.5">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = reviewStatus(row);
            return (
              <tr key={row.presentation_id} className="border-b border-border-default last:border-b-0">
                <td className="max-w-64 px-5 py-3">
                  <Link href={`/presentation/${row.presentation_id}`} className="block truncate font-semibold text-text-primary hover:text-accent">
                    {row.title || "Untitled presentation"}
                    <LinkPending />
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold whitespace-nowrap ${status.className}`}>
                    {status.label}
                  </span>
                </td>
                <td className="px-5 py-3 text-text-secondary">{row.status === "reviewing" ? (row.admin_note ?? "") : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Same labels and colors as before the table.
function reviewStatus(row: MyReviewRow) {
  if (row.status === "canceled") {
    return { label: row.canceled_by_admin ? "Canceled by QuizMatter" : "Canceled by you", className: "bg-danger-soft text-danger-strong" };
  }
  if (row.status === "submitted") return { label: "Waiting for QuizMatter", className: "bg-bg-page text-text-secondary" };
  if (row.admin_note) return { label: "Sent back", className: "bg-highlight-soft text-highlight-strong" };
  return { label: "Reviewing", className: "bg-accent-soft text-accent" };
}
```

- [ ] **Step 3: `src/app/MySubmissions.tsx`**:

```tsx
import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { timeAgo } from "@/lib/format";
import { SUBMISSION_LABELS, type MySubmission } from "@/lib/submissions";

/**
 * An editor's presentations sent to QuizMatter, as a table (see the quizmatter_submissions migration). The title
 * opens my presentation; an approved one also links to QuizMatter's copy.
 */
export function SubmissionsTable({ rows }: { rows: MySubmission[] }) {
  const now = Date.now();
  return (
    // Scrolls sideways on narrow phones instead of breaking the page.
    <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
          <tr className="border-b border-border-default">
            <th className="px-5 py-2.5">Presentation</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Note</th>
            <th className="px-5 py-2.5">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.presentationId} className="border-b border-border-default last:border-b-0">
              <td className="max-w-64 px-5 py-3">
                <Link href={`/presentation/${row.presentationId}`} className="block truncate font-semibold text-text-primary hover:text-accent">
                  {row.title || "Untitled presentation"}
                  <LinkPending />
                </Link>
                {row.status === "approved" && row.copyId && (
                  <Link href={`/presentation/${row.copyId}`} className="text-[13px] text-accent hover:underline">
                    See it in QuizMatter
                    <LinkPending />
                  </Link>
                )}
              </td>
              <td className="px-3 py-3">
                <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold whitespace-nowrap ${SUBMISSION_LABELS[row.status].className}`}>
                  {SUBMISSION_LABELS[row.status].label}
                </span>
              </td>
              <td className="px-3 py-3 text-text-secondary">{row.status === "sent_back" ? row.adminNote : ""}</td>
              <td className="px-5 py-3 whitespace-nowrap text-text-secondary">{timeAgo(row.submittedAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: the page** (`reviews-submissions/page.tsx`): load `loadMySubmissions(supabase)` in the
  `Promise.all`; render, in order: `PartLabel` "Reviews" + `ReviewsTable` (open and canceled rows together, only
  if any), `PartLabel` "Submissions" + `SubmissionsTable` (only if any), `PartLabel` "Published" + the existing
  `SavableCards` (only if any). Each `PartLabel` after the first gets `className="mt-6"`. When all three are empty:
  `<Empty>You haven&apos;t reviewed or submitted any presentations yet.</Empty>`. Rename the function
  `ReviewsSubmissionsPage`; comment: `"Reviews & submissions" (editors only): my review rounds and my submissions as tables, then the live presentations I reviewed.`

- [ ] **Step 5: tab + count**: in `HomeTabs.tsx` the tab becomes
  `{ id: "reviewed", label: "Reviews & submissions", href: "/reviews-submissions" }`. In `layout.tsx`
  `loadTabCounts`, add `isEditor ? supabase.rpc("my_submissions") : { data: [], error: null }` to the `Promise.all`
  and its error check, and add its `presentation_id`s to the `reviewed` Set. Update the layout's top comment path.

- [ ] **Step 6: CLAUDE.md**: in "Presentation Reviews", change `"My reviews" page (`/reviews`, `src/app/(home)/reviews/page.tsx`)`
  to `"Reviews & submissions" page (`/reviews-submissions`, `src/app/(home)/reviews-submissions/page.tsx`)` and
  `both `ReviewRows`` to `the `ReviewsTable``. Add a section after it:

```markdown
# Submit to QuizMatter (editors offer their own presentations)

An editor sends one of their own presentations to QuizMatter; an admin approves it or sends it back with a note.
Full design: `docs/superpowers/specs/2026-10-12-quizmatter-submissions-design.md`. Keep these rules:

- **Copy on approval:** `approve_submission` copies the presentation and its slides in one step: a shared QuizMatter
  presentation (`from_admin`), owned by the approving admin, Author = the editor. The editor keeps their original.
- **Locked while waiting:** a `submitted` row in `presentation_submissions` counts in `is_review_locked`, so the
  review lock triggers refuse changes (`QMREV`). No Withdraw. Approved can't be submitted again.
- **The rules live in the database functions** (`submit_presentation`, `approve_submission`, `send_back_submission`,
  `my_submissions`, `admin_submissions`, `submission_status`). Migration: `20261119000000_quizmatter_submissions.sql`.
- **In the app:** reads through `src/lib/submissions.ts` (`SUBMISSION_LABELS` for the words and colors); actions
  `submitToQuizMatter` (`src/app/actions.ts`), `approveSubmission` / `sendBackSubmission` (admin actions). Admin
  pages under `src/app/admin/presentations/submissions`.
```

- [ ] **Step 7:** `npx tsc --noEmit` and `npm run lint`. Expected: no errors (the `.next` route types may need
  `npx next typegen` if `PageProps<"/reviews">` errors appear; the moved page uses no `PageProps`).
- [ ] **Step 8: Commit** — `git add -A "src/app/(home)" src/app/MyReviews.tsx src/app/MySubmissions.tsx CLAUDE.md` and `git commit -m "Reviews & submissions tab: reviews and submissions as tables"`.

---

### Task 6: Admin pages (Submissions list and decision)

**Files:**
- Modify: `src/app/admin/presentations/page.tsx` (Submissions button)
- Create: `src/app/admin/presentations/submissions/page.tsx`
- Create: `src/app/admin/presentations/submissions/[id]/page.tsx`
- Create: `src/app/admin/presentations/submissions/[id]/SubmissionDecision.tsx`
- Modify: `src/components/presentation/ReviewDraftView.tsx` (optional `byLabel`)

**Interfaces:**
- Consumes: `approveSubmission`, `sendBackSubmission` (Task 2); `loadPresentation` (`@/lib/fetchPresentation`);
  `ReviewDraftView`, `PresentDraftButton`.
- Produces: `ReviewDraftView({ presentation, fields, byLabel? })` (`byLabel` default `"Reviewed by"`).

- [ ] **Step 1: Submissions button**: in `admin/presentations/page.tsx` add `supabase.rpc("admin_submissions")` to
  the `Promise.all` (check its error), and next to the "Under review" link (same classes), with `InboxIcon`:

```tsx
        <Link href="/admin/presentations/submissions" className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page">
          <InboxIcon size={16} />
          Submissions{submissions.data.length > 0 && ` (${submissions.data.length})`}
          <LinkPending />
        </Link>
```

- [ ] **Step 2: list page** `submissions/page.tsx`, same shape as `reviews/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { getAccount } from "@/lib/account";
import { timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type SubmissionRow = { presentation_id: string; title: string; editor_name: string; editor_email: string; submitted_at: string };

/**
 * Admin → Presentations → Submissions: editors' presentations waiting for QuizMatter, oldest first. Each opens its
 * page, to approve or send back (see the quizmatter_submissions migration).
 */
export default async function AdminSubmissionsPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_submissions");
  if (error) throw error;
  const rows = data as SubmissionRow[];
  const now = Date.now();

  return (
    <>
      <Link href="/admin/presentations" className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary">
        <ChevronLeftIcon size={16} />
        Presentations
        <LinkPending />
      </Link>

      <div className="overflow-hidden rounded-card border border-border-default bg-bg-surface">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-text-secondary">No presentations are waiting.</p>
        ) : (
          rows.map((row) => (
            <Link
              key={row.presentation_id}
              href={`/admin/presentations/submissions/${row.presentation_id}`}
              className="flex min-h-14 items-center gap-4 border-b border-border-default px-5 py-3 transition-colors last:border-b-0 hover:bg-bg-page"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">{row.title || "Untitled presentation"}</p>
                <p className="mt-0.5 truncate text-[13px] text-text-secondary">
                  {row.editor_name} · {row.editor_email} · Submitted {timeAgo(Date.parse(row.submitted_at), now).toLowerCase()}
                </p>
              </div>
              <LinkPending />
            </Link>
          ))
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: `ReviewDraftView` `byLabel`**: add `byLabel = "Reviewed by"` to its props
  (`byLabel?: string`) and use `{byLabel}` in the first `<dt>`. Update its comment: "…also the admin's
  Submissions page (`byLabel` "Submitted by")."

- [ ] **Step 4: decision page** `submissions/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { PresentDraftButton } from "@/components/presentation/PresentDraftButton";
import { ReviewDraftView } from "@/components/presentation/ReviewDraftView";
import { getAccount } from "@/lib/account";
import { loadPresentation } from "@/lib/fetchPresentation";
import { detailsLabel, joinParts, slideCountLabel } from "@/lib/format";
import { usesPeopleArt } from "@/lib/peopleArt";
import { gradesTitle } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { SubmissionDecision } from "./SubmissionDecision";

type SubmissionRow = { presentation_id: string; editor_name: string; editor_email: string; submitted_at: string };

/** An editor's presentation waiting for QuizMatter: view only, with Present, Send back and Approve. */
export default async function AdminSubmissionPage({ params }: PageProps<"/admin/presentations/submissions/[id]">) {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data, error }, result] = await Promise.all([supabase.rpc("admin_submissions"), loadPresentation(supabase, id)]);
  if (error) throw error;
  // Only waiting ones are in the list: decided already (or never submitted) = not found.
  const submission = (data as SubmissionRow[]).find((row) => row.presentation_id === id);
  if (!submission || !result) notFound();
  const { presentation } = result;

  return (
    <PeopleArtGate needed={usesPeopleArt(presentation.slides)}>
      <Link href="/admin/presentations/submissions" className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary">
        <ChevronLeftIcon size={16} />
        Submissions
        <LinkPending />
      </Link>

      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-text-primary">{presentation.title || "Untitled presentation"}</h2>
          <p title={gradesTitle(presentation.grades)} className="mt-0.5 text-sm text-text-secondary">
            {joinParts([detailsLabel(presentation), slideCountLabel(presentation.slides.length)])}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* It's locked while it waits, so this is exactly what Approve copies. */}
          <PresentDraftButton
            presentation={presentation}
            className="rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page"
          />
          <SubmissionDecision presentationId={id} />
        </div>
      </header>

      <ReviewDraftView
        presentation={presentation}
        byLabel="Submitted by"
        fields={{ name: submission.editor_name, email: submission.editor_email, reviewedOn: submission.submitted_at.slice(0, 10) }}
      />
    </PeopleArtGate>
  );
}
```

  (Check `ReviewerFields`' exact keys in `src/lib/schema.ts`; if it has more, fill them the same way.)

- [ ] **Step 5: `SubmissionDecision.tsx`**: a copy of `reviews/[id]/ReviewDecision.tsx` with these differences
  only: imports `approveSubmission, sendBackSubmission` from `../../actions`; the main button is "Approve"
  (`CheckIcon`), its confirm is `"Approve it? QuizMatter gets its own copy, shared with every teacher right away, with the editor as the Author."`,
  success toast `"Approved. It's now shared with every teacher, under QuizMatter."`; the modal title is
  `"Send back to the editor"`, success toast `"Sent back to the editor."`; both push
  `"/admin/presentations/submissions"`; component comment: `/** Approve (QuizMatter gets its own shared copy) or Send back (with a note for the editor). */`.
  Keep the zod check of the note before sending, the `Spinner`, and `TopLoadingBar`.

- [ ] **Step 6:** `npx tsc --noEmit` and `npm run lint`. Expected: no errors. (`admin/loading.tsx` already covers
  these pages with the top line and Spinner.)
- [ ] **Step 7: Commit** — `git commit -m "Admin: Submissions list and Approve / Send back"`.

---

### Task 7: Final checks

- [ ] **Step 1:** `npx tsc --noEmit` and `npm run lint` on the whole repo; fix errors in the changed files.
- [ ] **Step 2:** `git diff <commit before Task 1>..HEAD` next to the spec: every spec part done, nothing extra;
  zod before every RPC, one Spinner / TopLoadingBar, design system classes, toasts on every action, no new package.
- [ ] **Step 3:** Tell the user what passed or failed, that the migration was applied, and what to try live: submit
  as an editor (card label, locked edit page, refused save in an old tab), send back (note in the editor and the
  table, Submit again), approve (shared copy, Author, Publisher QuizMatter, photos, "In QuizMatter" label, no
  Submit), and taking the editor role away while one waits (Canceled).
