# Review Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A submitted review opens view-only; the reviewer's top bar becomes "Save as draft" + a ⋮ actions menu;
Admin → Presentations gets a "Review" column whose "Reviewed" pill opens a modal with every reviewer and the admin
who approved them.

**Architecture:** One small migration records who approved each reviewer (`approved_by`, `approved_at`) and adds an
admin-only `admin_reviewers()` list. A shared `ReviewDraftView` component shows a draft's details, "Reviewed by"
and slide pictures; the admin review page and a new read-only `ReviewSubmittedView` use it. The editor's review
mode drops its "submitted" state.

**Tech Stack:** Next.js 16, Supabase (Postgres rpc), zustand, sonner, lucide-react, Tailwind design classes.

**Spec:** `docs/superpowers/specs/2026-10-04-presentation-reviews-design.md` (section "Addendum")

## Global Constraints

- Design system classes only; Lucide icons with `size`; Mint (`success`) only for done/correct; Coral (`danger`) only for errors/delete/destructive.
- One Spinner, `TopLoadingBar` / `LinkPending` for waits; toasts on every save/change.
- zod before every save (nothing new is saved in this plan except through existing functions).
- No new packages.
- Plain-English comments in the existing style.

## Review Focus

1. A reviewer who submitted and then opens the edit link (e.g. from browser history) must get the read-only page, never the editor. Checked in Task 3 by `tsc` plus reading the branch in `edit/page.tsx`.
2. A sent-back review (status reviewing with a note) must open the editor, with the note banner. Task 3.
3. The ⋮ menu must close on outside click / Esc and never leave the form modal and the menu open together. Task 4.
4. A presentation reviewed by two editors shows both cards in the modal, each with its own approver. SQL check in Task 1.
5. A presentation with no reviewers shows "Not reviewed" and nothing clickable. Task 5.

No unit-test runner (adding one is a new dependency). SQL is checked inside a `do` block that ends with
`raise exception '… PASSED'` (rolls everything back); app code with `npx tsc --noEmit` and `npx eslint <files>`.

---

### Task 1: Record the approving admin

**Files:**
- Create: `supabase/migrations/20261021000000_review_approvals.sql`

**Interfaces:**
- Produces: columns `presentation_reviewers.approved_by uuid`, `approved_at timestamptz`; rpc
  `admin_reviewers() → table(presentation_id text, name text, email text, background text, reviewed_on date, approved_at timestamptz, approver_name text, approver_email text)`.

- [ ] **Step 1: RED** — run with `execute_sql`:

```sql
do $$ begin perform * from public.admin_reviewers(); raise exception 'APPROVAL CHECKS PASSED'; end $$;
```

Expected: `function public.admin_reviewers() does not exist`.

- [ ] **Step 2: Write the migration**

```sql
-- Who approved each reviewer (Admin → Presentations → Review column). publish_review records the admin and the
-- time; admin_reviewers() lists every reviewer with that admin's name and email. See the spec's addendum in
-- docs/superpowers/specs/2026-10-04-presentation-reviews-design.md.

alter table public.presentation_reviewers
  add column approved_by uuid references auth.users (id) on delete set null,
  add column approved_at timestamptz;

-- Same as before (20261019000000_presentation_reviews.sql), plus approved_by / approved_at on the reviewer's row.
create or replace function public.publish_review(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews;
  d jsonb;
  f jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can publish reviews.' using errcode = '42501';
  end if;
  select * into review from public.presentation_reviews r where r.presentation_id = target_id for update;
  if not found or review.status is distinct from 'submitted' or review.reviewer_id is null then
    raise exception 'This review isn''t waiting to be published.' using errcode = 'QMRVW';
  end if;
  d := review.draft;
  f := review.submitted_fields;

  -- Lets the lock triggers through for these changes only (until this transaction ends).
  perform set_config('quizmatter.publishing_review', 'yes', true);

  update public.presentations p set
    title = d ->> 'title',
    description = d ->> 'description',
    grade = d ->> 'grade',
    subject = d ->> 'subject',
    curriculum = d ->> 'curriculum',
    learning_competency = d ->> 'learningCompetency',
    reference_links = array(select jsonb_array_elements_text(d -> 'referenceLinks')),
    tags = array(select jsonb_array_elements_text(coalesce(d -> 'tags', '[]'))),
    transition = coalesce(d ->> 'transition', 'slide'),
    transition_speed = coalesce((d ->> 'transitionSpeed')::smallint, 3),
    updated_at = now()
  where p.id = target_id;

  delete from public.slides s
  where s.presentation_id = target_id
    and s.id not in (select slide ->> 'id' from jsonb_array_elements(d -> 'slides') as slide);

  insert into public.slides (presentation_id, id, position, data)
  select target_id, slide ->> 'id', (ord - 1)::int, slide
  from jsonb_array_elements(d -> 'slides') with ordinality as t(slide, ord)
  on conflict (presentation_id, id) do update set position = excluded.position, data = excluded.data;

  perform set_config('quizmatter.publishing_review', '', true);

  insert into public.presentation_reviewers (
    presentation_id, reviewer_id, name, email, background, reviewed_on, approved_by, approved_at
  )
  values (
    target_id, review.reviewer_id, f ->> 'name', f ->> 'email', f ->> 'background', (f ->> 'reviewedOn')::date,
    auth.uid(), now()
  )
  on conflict (presentation_id, reviewer_id) do update set
    name = excluded.name,
    email = excluded.email,
    background = excluded.background,
    reviewed_on = excluded.reviewed_on,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at;

  update public.presentation_reviews set
    status = 'published',
    ended_at = now(),
    last_reviewer_id = review.reviewer_id,
    draft = null,
    draft_updated_at = null,
    submitted_fields = null,
    admin_note = null
  where presentation_id = target_id;
end;
$$;

-- Every reviewer of every presentation, with the approving admin's display name and email (auth.users is only
-- readable here). Admins only: others get no rows.
create function public.admin_reviewers()
returns table (
  presentation_id text,
  name text,
  email text,
  background text,
  reviewed_on date,
  approved_at timestamptz,
  approver_name text,
  approver_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.presentation_id,
    r.name,
    r.email,
    r.background,
    r.reviewed_on,
    r.approved_at,
    coalesce(s.display_name, ''),
    coalesce(u.email, '')
  from public.presentation_reviewers r
  left join public.user_settings s on s.user_id = r.approved_by
  left join auth.users u on u.id = r.approved_by
  where public.is_admin()
  order by r.reviewed_on desc;
$$;

revoke execute on function public.admin_reviewers() from public, anon;
grant execute on function public.admin_reviewers() to authenticated;
```

- [ ] **Step 3: Apply** with `apply_migration` (name `review_approvals`, project `zmmkqncfbjkmwfyngaha`).

- [ ] **Step 4: GREEN** — `execute_sql`:

```sql
do $$
declare
  pid text; admin_id uuid; editor_id uuid; live jsonb; d jsonb; t bigint; n int;
  fields jsonb := '{"name":"Ana","email":"ana@example.com","background":"Master Teacher","reviewedOn":"2026-10-04"}';
begin
  select p.id, p.owner_id into pid, admin_id from public.presentations p
  where p.from_admin and p.is_published and p.hidden_at is null limit 1;
  select u.id into editor_id from auth.users u where u.id not in (select user_id from public.admins) limit 1;
  insert into public.editors (user_id) values (editor_id), (admin_id) on conflict do nothing;
  select jsonb_agg(s.data order by s.position) into live from public.slides s where s.presentation_id = pid;
  d := jsonb_build_object('id', pid, 'title', 'T', 'description', '', 'grade', '', 'subject', '', 'curriculum', '',
    'learningCompetency', '', 'referenceLinks', '[]'::jsonb, 'tags', '[]'::jsonb, 'slides', live);

  -- Round 1: the teacher reviews, the admin approves.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id)::text, true);
  perform public.start_review(pid);
  perform public.submit_review(pid, d, fields, null);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);
  perform public.publish_review(pid);
  -- Round 2: opened to all; the admin (also an editor here) reviews, the admin approves.
  perform public.set_review_open(pid, true);
  perform public.start_review(pid);
  perform public.submit_review(pid, d, fields || '{"name":"Ben"}', null);
  perform public.publish_review(pid);

  select count(*) into n from public.admin_reviewers() r
  where r.presentation_id = pid and r.approver_email <> '' and r.approved_at is not null;
  if n <> 2 then raise exception 'FAIL expected 2 approved reviewers, got %', n; end if;

  -- Not an admin: no rows.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_id)::text, true);
  if exists (select 1 from public.admin_reviewers()) then raise exception 'FAIL non-admin sees rows'; end if;

  raise exception 'APPROVAL CHECKS PASSED';
end $$;
```

Expected: `APPROVAL CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261021000000_review_approvals.sql
git commit -m "Record which admin approved each review"
```

---

### Task 2: Shared `ReviewDraftView`

**Files:**
- Create: `src/components/presentation/ReviewDraftView.tsx`
- Modify: `src/app/admin/presentations/reviews/[id]/page.tsx`

**Interfaces:**
- Produces: `ReviewDraftView({ presentation: Presentation; fields: ReviewerFields })` — the details card (with "Reviewed by" first) and the slide-picture grid. No hooks, so it works on server and client pages.

- [ ] **Step 1: Create `ReviewDraftView.tsx`**

```tsx
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { CANVAS_HEIGHT, CANVAS_WIDTH, getSlideNumbers } from "@/lib/constants";
import { formatDay } from "@/lib/format";
import type { Presentation, ReviewerFields } from "@/lib/schema";

/**
 * A review's draft, view only: the "Reviewed by" details, the presentation's details, and every slide as a
 * picture. Used by the admin's review page and by the reviewer's page once they've submitted.
 */
export function ReviewDraftView({ presentation, fields }: { presentation: Presentation; fields: ReviewerFields }) {
  const slideNumbers = getSlideNumbers(presentation.slides);
  const details = [
    { label: "Description", value: presentation.description },
    { label: "Curriculum", value: presentation.curriculum },
    { label: "Learning competency", value: presentation.learningCompetency },
    { label: "Tags", value: presentation.tags.join(", ") },
    { label: "References", value: presentation.referenceLinks.join("\n") },
  ].filter((detail) => detail.value);

  return (
    <>
      <dl className="mb-6 grid gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-4 text-sm">
        <div>
          <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Reviewed by</dt>
          <dd className="mt-1 text-text-primary">
            <span className="font-semibold">{fields.name}</span>
            <span className="text-text-secondary">
              {" "}
              · {fields.email} · {formatDay(fields.reviewedOn)}
            </span>
            <span className="mt-0.5 block whitespace-pre-line text-text-secondary">{fields.background}</span>
          </dd>
        </div>
        {details.map((detail) => (
          <div key={detail.label}>
            <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{detail.label}</dt>
            <dd className="mt-1 whitespace-pre-line break-words text-text-primary">{detail.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {presentation.slides.map((slide, index) => (
          <div key={slide.id}>
            <div
              className="overflow-hidden rounded-dropdown border border-border-default bg-bg-surface"
              style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
            >
              <FluidSlidePreview slide={slide} questionNumber={slideNumbers.get(slide.id)} />
            </div>
            <span className="mt-1.5 block text-[13px] text-text-secondary">{index + 1}</span>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Admin review page uses it** — in `reviews/[id]/page.tsx`, replace the `<dl>…</dl>` and the slide grid
  with `<ReviewDraftView presentation={presentation} fields={fields} />`; remove the now-unused imports
  (`FluidSlidePreview`, `CANVAS_*`, `getSlideNumbers`, `formatDay`) and the `slideNumbers` / `details` constants.

- [ ] **Step 3: Check** — `npx tsc --noEmit`; `npx eslint src/components/presentation/ReviewDraftView.tsx "src/app/admin/presentations/reviews"`. Expected: clean.

- [ ] **Step 4: Commit** — `git add` both files; `git commit -m "Share the review draft view between pages"`.

---

### Task 3: Submitted review opens read-only; editor drops "submitted"

**Files:**
- Create: `src/app/presentation/[id]/edit/ReviewSubmittedView.tsx`
- Modify: `src/app/presentation/[id]/edit/page.tsx`
- Modify: `src/lib/store.ts`
- Modify: `src/components/editor/EditorTopBar.tsx` (SaveButton)
- Modify: `src/components/editor/ReviewControls.tsx` (ReviewBanner, submitted branch)

**Interfaces:**
- Consumes: `ReviewDraftView` (Task 2).
- Produces: `EditorReview = { note: string; fields: ReviewerFields }` (no `status`).

- [ ] **Step 1: `ReviewSubmittedView.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { ReviewDraftView } from "@/components/presentation/ReviewDraftView";
import { joinParts, slideCountLabel } from "@/lib/format";
import type { Presentation, ReviewerFields } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

// Only downloaded when the reviewer clicks Present.
const PresentationView = dynamic(() =>
  import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView)
);

/**
 * What a reviewer sees after submitting: their version, view only (no editor, no tools), while QuizMatter
 * checks it. Present shows it fullscreen.
 */
export function ReviewSubmittedView({ presentation, fields }: { presentation: Presentation; fields: ReviewerFields }) {
  const isPresenting = useEditorStore((s) => s.isPresenting);

  // The presentation view reads the editor's store, so the presentation goes in there first.
  const present = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen isn't available (unsupported/blocked) — presentation still opens.
    }
    const store = useEditorStore.getState();
    store.loadPresentation(presentation);
    store.startPresentation();
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <Link href={`/presentation/${presentation.id}`} className="text-sm text-text-secondary transition-colors hover:text-text-primary">
        ← Back to the presentation
        <LinkPending />
      </Link>

      <p className="mt-3 rounded-card bg-highlight-soft px-5 py-3 text-sm text-text-primary">
        Submitted. QuizMatter will publish your changes in 1–2 days. Until then you can look at your version, but not
        change it.
      </p>

      <header className="mt-4 mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-extrabold text-text-primary">{presentation.title || "Untitled presentation"}</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            {joinParts([presentation.grade, presentation.subject, slideCountLabel(presentation.slides.length)])}
          </p>
        </div>
        <button
          type="button"
          onClick={present}
          className="ml-auto rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Present
        </button>
      </header>

      <ReviewDraftView presentation={presentation} fields={fields} />
      {isPresenting && <PresentationView />}
    </main>
  );
}
```

- [ ] **Step 2: `edit/page.tsx`** — after building `presentation` and `fields`:

```tsx
  // Submitted: waiting for an admin, so it's view only (no editor at all).
  if (row.status === "submitted") {
    return (
      <PeopleArtGate needed={usesPeopleArt(presentation.slides)}>
        <ReviewSubmittedView presentation={presentation} fields={fields} />
      </PeopleArtGate>
    );
  }
  const review: EditorReview = { note: row.admin_note ?? "", fields };
```

(imports: `PeopleArtGate`, `usesPeopleArt`, `ReviewSubmittedView`.)

- [ ] **Step 3: `store.ts`** — `export type EditorReview = { note: string; fields: ReviewerFields };` with the comment
  "An editor reviewing someone else's QuizMatter presentation…: the admin's note when it was sent back ("" if
  none), and the "Reviewed by" form's starting values."; the `review` field comment becomes "Set while an editor
  reviews someone else's QuizMatter presentation: saves go to their draft. null = a normal presentation."; remove
  the `if (review?.status === "submitted") return false;` line and its comment.

- [ ] **Step 4: `EditorTopBar.tsx` SaveButton** — remove `if (review?.status === "submitted") return null;` and the
  ", and is gone once the review is submitted" part of the comment.

- [ ] **Step 5: `ReviewControls.tsx`** — remove the `review.status === "submitted"` branch; after a successful submit set
  `useEditorStore.setState({ savedPresentation: presentation })` (no `review` change); `ReviewBanner` becomes:

```tsx
/** Under the top bar, after QuizMatter sent the review back: the admin's note. */
export function ReviewBanner() {
  const note = useEditorStore((s) => s.review?.note);
  if (!note) return null;
  return (
    <p className="shrink-0 border-b border-border-default bg-highlight-soft px-4 py-2 text-sm text-text-primary">
      QuizMatter sent this back: {note}
    </p>
  );
}
```

- [ ] **Step 6: Check** — `npx tsc --noEmit`; `npx eslint` on the five files. Expected: clean. Read the branch order in
  `edit/page.tsx`: submitted → read-only; reviewing (note or not) → editor (Review Focus 1 and 2).

- [ ] **Step 7: Commit** — `git commit -m "Open a submitted review view only, without the editor"`.

---

### Task 4: ⋮ actions menu

**Files:**
- Modify: `src/components/editor/ReviewControls.tsx` (`ReviewControls`)

- [ ] **Step 1: Replace the two buttons with the menu**

```tsx
export function ReviewControls() {
  const router = useRouter();
  const review = useEditorStore((s) => s.review);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Closes on a click outside the menu, or on Esc (like the account menu).
  useEffect(() => {
    if (!isMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setIsMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMenuOpen]);

  if (!review) return null;

  const stop = async () => { /* unchanged, but first: setIsMenuOpen(false); */ };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsMenuOpen((open) => !open)}
        disabled={isStopping}
        aria-label="Review actions"
        aria-expanded={isMenuOpen}
        title="Review actions"
        className="flex h-9 w-9 items-center justify-center rounded-button text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
      >
        {isStopping ? <Spinner size={16} /> : <EllipsisVerticalIcon size={18} />}
      </button>

      {isMenuOpen && (
        <div className="absolute top-11 right-0 z-50 w-56 rounded-card border border-border-default bg-bg-surface p-2">
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false);
              setIsFormOpen(true);
            }}
            className={menuItemClass}
          >
            <SendIcon size={16} />
            Submit for publishing
          </button>
          <button type="button" onClick={stop} className={stopItemClass}>
            <XCircleIcon size={16} />
            Stop review
          </button>
        </div>
      )}
      {isStopping && <TopLoadingBar />}
      {isFormOpen && <SubmitForm initial={review.fields} onClose={() => setIsFormOpen(false)} />}
    </div>
  );
}

const menuItemClass =
  "flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm font-semibold text-text-primary transition-colors hover:bg-accent-soft hover:text-accent";
// Coral: it throws the reviewer's work away.
const stopItemClass =
  "flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm font-semibold text-danger-strong transition-colors hover:bg-danger-soft";
```

(`stop` keeps its body, starting with `setIsMenuOpen(false);`.)
Imports: `useEffect, useRef` from react, `EllipsisVerticalIcon` from lucide-react; remove `secondaryButtonClass`.

- [ ] **Step 2: Check** — `npx tsc --noEmit`; `npx eslint src/components/editor/ReviewControls.tsx`. Expected: clean.

- [ ] **Step 3: Commit** — `git commit -m "Put Submit and Stop review in a menu next to Save as draft"`.

---

### Task 5: "Review" column and modal

**Files:**
- Create: `src/app/admin/presentations/ReviewersModal.tsx`
- Modify: `src/app/admin/presentations/page.tsx`
- Modify: `src/app/admin/presentations/AdminPresentations.tsx`

**Interfaces:**
- Consumes: `admin_reviewers()` (Task 1).
- Produces: `type ApprovedReviewer = ReviewerFields & { approvedAt: string | null; approverName: string; approverEmail: string }` (exported from `ReviewersModal.tsx`); `AdminPresentationRow.reviewers: ApprovedReviewer[]`.

- [ ] **Step 1: `ReviewersModal.tsx`**

```tsx
"use client";

import { Modal } from "@/components/Modal";
import { formatDay, joinParts } from "@/lib/format";
import type { ReviewerFields } from "@/lib/schema";

/** One reviewer of a presentation, with the admin who approved their review (Admin → Presentations). */
export type ApprovedReviewer = ReviewerFields & { approvedAt: string | null; approverName: string; approverEmail: string };

/** Everyone who reviewed the presentation, newest first, and who approved each review. */
export function ReviewersModal({ title, reviewers, onClose }: { title: string; reviewers: ApprovedReviewer[]; onClose: () => void }) {
  return (
    <Modal title={`Reviewed by · ${title}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {reviewers.map((reviewer) => (
          <div key={`${reviewer.email}-${reviewer.reviewedOn}`} className="rounded-card border border-border-default px-5 py-3.5 text-sm">
            <p className="font-semibold text-text-primary">{reviewer.name}</p>
            <p className="mt-0.5 text-text-secondary">
              {reviewer.email} · Reviewed {formatDay(reviewer.reviewedOn)}
            </p>
            <p className="mt-2 whitespace-pre-line text-text-primary">{reviewer.background}</p>
            <p className="mt-3 border-t border-border-default pt-2.5 text-[13px] text-text-secondary">
              Approved by{" "}
              <span className="font-semibold text-text-primary">{approverLabel(reviewer)}</span>
              {reviewer.approvedAt && ` · ${formatDay(reviewer.approvedAt.slice(0, 10))}`}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  );
}
```

and below the component:

```tsx
// "Ana Cruz (ana@school.ph)", just the email if they have no display name, or "an admin" if the account is gone.
function approverLabel(reviewer: ApprovedReviewer): string {
  if (reviewer.approverName && reviewer.approverEmail) return `${reviewer.approverName} (${reviewer.approverEmail})`;
  return reviewer.approverName || reviewer.approverEmail || "an admin";
}
```

(`joinParts` is then unused in this file: import only `formatDay`.)

- [ ] **Step 2: `page.tsx`** — add `supabase.rpc("admin_reviewers")` to the `Promise.all` (as `reviewers`), throw on its
  error, group by `presentation_id` into `Map<string, ApprovedReviewer[]>`:

```ts
  const reviewersById = new Map<string, ApprovedReviewer[]>();
  for (const row of reviewers.data as AdminReviewerRow[]) {
    const list = reviewersById.get(row.presentation_id) ?? [];
    list.push({
      name: row.name,
      email: row.email,
      background: row.background,
      reviewedOn: row.reviewed_on,
      approvedAt: row.approved_at,
      approverName: row.approver_name,
      approverEmail: row.approver_email,
    });
    reviewersById.set(row.presentation_id, list);
  }
```

with `type AdminReviewerRow = { presentation_id: string; name: string; email: string; background: string; reviewed_on: string; approved_at: string | null; approver_name: string; approver_email: string };`.
Pass it to `buildRows`; draft rows get `reviewers: []`, saved rows `reviewers: reviewersById.get(presentation.id) ?? []`.

- [ ] **Step 3: `AdminPresentations.tsx`**
  - `AdminPresentationRow.reviewers: ApprovedReviewer[]` (comment: "Everyone whose review an admin published (the Review column).").
  - `COLUMNS`: `sm:grid-cols-[96px_minmax(0,1fr)_104px_112px_56px_104px_120px_112px_36px]`, comment lists "status, review,".
  - Header: `<span className="hidden sm:block">Review</span>` right after Status.
  - In `Row`: `const [isReviewersOpen, setIsReviewersOpen] = useState(false);` and right after the status pill:

```tsx
        {row.reviewers.length > 0 ? (
          <button
            type="button"
            onClick={() => setIsReviewersOpen(true)}
            title="See who reviewed it"
            className="relative z-10 inline-flex w-fit items-center rounded-dropdown bg-success-soft px-2.5 py-1 text-[13px] leading-none font-semibold text-success-strong transition-colors hover:bg-success-soft/70"
          >
            Reviewed
          </button>
        ) : (
          <span className="text-[13px] text-text-secondary">Not reviewed</span>
        )}
```

  - At the end of the row: `{isReviewersOpen && <ReviewersModal title={row.title} reviewers={row.reviewers} onClose={() => setIsReviewersOpen(false)} />}`.
  - The search text also includes `row.reviewers.length > 0 ? "reviewed" : "not reviewed"`.

- [ ] **Step 4: Check** — `npx tsc --noEmit`; `npx eslint src/app/admin/presentations`. Expected: clean. Confirm Review Focus 5 by reading: no reviewers → plain text, no button.

- [ ] **Step 5: Commit** — `git commit -m "Add a Review column with who reviewed and who approved"`.

---

### Task 6: Final check

- [ ] `npx tsc --noEmit`, `npx eslint src` (whole-project `npm run lint` runs out of memory here); only the known `PanelControls.tsx` error is allowed.
- [ ] Read the diff next to the spec addendum; then the fresh whole-branch review.
