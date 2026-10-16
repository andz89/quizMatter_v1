# Shared Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher's Publish makes a shared copy that other teachers see; the teacher's later edits stay private
until they click "Update shared presentation".

**Architecture:** The copy is a normal `presentations` row (+ `slides`) with `shared_from` = the original's id.
Two security-definer database functions (`share_presentation`, `unshare_presentation`) are the only way to make,
update or remove a copy; triggers refuse everything else. The editor keeps the copy's id and last copy time
(`sharedCopy`) in the store; the Share card shows "up to date" / "behind" and the Update button.

**Tech Stack:** Next.js (this repo's version), Supabase (Postgres functions/triggers, supabase-js), zustand, zod,
sonner, lucide-react. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-16-shared-copy-design.md`

## Global Constraints

- Teachers only: `from_admin` presentations keep today's Draft / Shared switch, unchanged.
- The migration deletes every presentation with `from_admin = false and is_published = true`.
- Validate input with zod before every rpc call (CLAUDE.md "Saving Data").
- Reuse `Spinner`, `ConfirmModal`/`Modal`, sonner toasts, design-system classes, Lucide `…Icon` with `size`.
- Click limits: reuse `share` and `publish` (`count_click`), `pausedUntilFromError` + `checkPauses`. No new limit.
- Migration functions: `set search_path = ''`, full names, `revoke … from public, anon`, `grant … to authenticated`.
- Plain, short English in comments, UI text and notes.
- No package changes. Ask the user before every commit to main (memory: work-on-main-in-dev).

## Review Focus

- **Deleting the original** must delete the copy, its slides, bookmarks and reports without the copy guard refusing
  (cascade). → SQL test T7.
- **Saving an old browser tab** that still sends `isPublished: true` for a teacher must save fine and stay private.
  → SQL test T2.
- **Update after an admin hid the copy** must keep it hidden. → SQL test T5.
- **Opening `/presentation/<my copy>/edit`** must open the original's editor, not a broken editor on the copy.
  → browser test B6.
- **"Behind" right after Publish / Update** must say "up to date" (the save time and copy time compare right).
  → browser test B2.

---

### Task 1: The database migration

**Files:**
- Create: `supabase/migrations/20261123000000_shared_copy.sql`
- Modify: `supabase/migrations/CLAUDE.md` ("Where the big features live", "Finding a function's newest version")

**Interfaces:**
- Produces:
  - Columns `presentations.shared_from text` (unique, FK → presentations.id, on delete cascade), `presentations.shared_at timestamptz`.
  - `public.share_presentation(target_id text) returns jsonb` → `{"id": "<copy id>", "sharedAt": <unix ms>}`.
    Errors: `42501` not mine / QuizMatter / a copy; `QMREV` locked; `QMPUB` empty; `QMBLK` paused.
  - `public.unshare_presentation(target_id text) returns void`. Errors: `42501`, `QMBLK`.

- [ ] **Step 1: Write the migration**

```sql
-- Shared copy: a teacher's Publish makes a copy that other teachers see (see
-- docs/superpowers/specs/2026-10-16-shared-copy-design.md).
--
-- Before, "published" was only a switch on the teacher's own presentation, so other teachers saw every save at once.
-- Now the copy is its own presentation row (shared_from = the original's id). The teacher keeps editing the original
-- in private; the copy changes only through share_presentation ("Update shared presentation" in the Share card).
--
-- - share_presentation makes the copy, or copies the original over it again (same id, so links, bookmarks and
--   reports stay). unshare_presentation (Private) deletes it. Deleting the original deletes it too (cascade).
-- - Nothing else can change a copy (shared_copy_change and shared_copy_slides triggers), except an admin hiding it.
-- - A teacher's original is never published itself (save_presentation and count_share_clicks).
-- - Copies don't count in the 50-presentation limit.
-- - QuizMatter (from_admin) presentations keep the old Draft / Shared switch.
--
-- Development stage: every teacher presentation published today is deleted.

-- ─── 1. Delete today's published teacher presentations ───────────────────────────────────────────────────────
-- The review lock triggers would refuse deleting one that waits for QuizMatter, so they're let through here.
select set_config('quizmatter.publishing_review', 'yes', true);
delete from public.presentations p where not p.from_admin and p.is_published;
select set_config('quizmatter.publishing_review', '', true);

-- ─── 2. The copy's columns ────────────────────────────────────────────────────────────────────────────────────
alter table public.presentations
  add column shared_from text unique references public.presentations (id) on delete cascade,
  add column shared_at timestamptz;

-- ─── 3. Nothing else changes a copy ───────────────────────────────────────────────────────────────────────────
-- Only share_presentation (it sets quizmatter.sharing). An admin may still hide or show a copy (hidden_at). Deleting
-- a copy isn't guarded: the owner's direct delete is the same as Private, and admins delete reported ones.
create function public.check_shared_copy_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('quizmatter.sharing', true), '') = 'yes' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.shared_from is null and new.shared_at is null then
      return new;
    end if;
  elsif old.shared_from is null then
    -- An original can't be turned into a copy.
    if new.shared_from is null and new.shared_at is not distinct from old.shared_at then
      return new;
    end if;
  -- tags_text and search_text are worked out by the database (null in NEW here), so they're left out.
  elsif (to_jsonb(new) - 'hidden_at' - 'tags_text' - 'search_text') = (to_jsonb(old) - 'hidden_at' - 'tags_text' - 'search_text') then
    return new;
  end if;
  raise exception 'A shared copy only changes with "Update shared presentation".' using errcode = '42501';
end;
$$;

create trigger shared_copy_change
  before insert or update on public.presentations
  for each row execute function public.check_shared_copy_change();

-- A copy's slides: same rule. When its presentation row is gone (deleted, or by cascade from the original), its
-- slides may go.
create function public.check_shared_copy_slides()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := case tg_op when 'DELETE' then old.presentation_id else new.presentation_id end;
begin
  if coalesce(current_setting('quizmatter.sharing', true), '') <> 'yes'
    and exists (select 1 from public.presentations p where p.id = target_id and p.shared_from is not null) then
    raise exception 'A shared copy only changes with "Update shared presentation".' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger shared_copy_slides
  before insert or update or delete on public.slides
  for each row execute function public.check_shared_copy_slides();

-- ─── 4. A teacher's original is never published itself ───────────────────────────────────────────────────────
-- Same trigger as before (20261106000000_fix_share_count_on_save.sql). It no longer counts clicks:
-- share_presentation and unshare_presentation do. It refuses publishing a teacher's original directly.
create or replace function public.count_share_clicks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.from_admin or new.shared_from is not null or not new.is_published then
    return new;
  end if;
  raise exception 'Publish with the Share button: it makes a shared copy.' using errcode = '42501';
end;
$$;

-- ─── 5. save_presentation: same as before (20261118000000_presentation_term.sql) ─────────────────────────────
-- Only a QuizMatter presentation's isPublished is saved; a teacher's original stays private (an old app tab may
-- still send true). The publish content check moved to share_presentation.
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

  -- Locked until the save ends, so two saves of the same presentation can't cross.
  select p.updated_at into saved_updated_at from public.presentations p where p.id = target_id for update;
  if found and (base_updated_at is null or floor(extract(epoch from saved_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This presentation was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;

  insert into public.presentations (
    id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at
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
    now()
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

-- ─── 6. The 50-presentation limit: same as before (20261011000000_lower_limits.sql), copies don't count ──────
create or replace function public.check_presentation_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_admin() or new.shared_from is not null then
    return new;
  end if;
  -- save_presentation's "insert … on conflict do update" runs this for existing presentations too: those are
  -- only being saved again, not added.
  if exists (select 1 from public.presentations p where p.id = new.id) then
    return new;
  end if;
  -- Two new presentations from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  -- Same as MAX_PRESENTATIONS in src/lib/schema.ts.
  if (select count(*) from public.presentations p where p.owner_id = new.owner_id and p.shared_from is null) >= 50 then
    raise exception 'You have 50 presentations, the most allowed.' using errcode = 'QMMAX';
  end if;
  return new;
end;
$$;

-- ─── 7. Publish / Update shared presentation ─────────────────────────────────────────────────────────────────
-- Makes the copy of my presentation, or copies it over the copy again. Counts a "share" click (and a "publish"
-- click the first time). Returns the copy's id and when it was copied (Unix ms).
create function public.share_presentation(target_id text)
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

revoke execute on function public.share_presentation(text) from public, anon;
grant execute on function public.share_presentation(text) to authenticated;

-- ─── 8. Private: removes the copy ────────────────────────────────────────────────────────────────────────────
-- Its bookmarks and reports go with it. Counts a "share" click. No copy = nothing happens.
create function public.unshare_presentation(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.presentations p
    where p.id = target_id and p.owner_id = auth.uid() and not p.from_admin and p.shared_from is null
  ) then
    raise exception 'You can only change your own presentations.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.presentations p where p.shared_from = target_id) then
    return;
  end if;
  perform public.count_click('share');
  delete from public.presentations p where p.shared_from = target_id;
end;
$$;

revoke execute on function public.unshare_presentation(text) from public, anon;
grant execute on function public.unshare_presentation(text) to authenticated;
```

- [ ] **Step 2: Update `supabase/migrations/CLAUDE.md`**

In "Finding a function's newest version", change the example to `(today: 20261123000000_shared_copy.sql)`. In
"Where the big features live", add:

```markdown
- Sharing (a teacher's Publish makes a shared copy, `shared_from`): `20261123000000_shared_copy.sql`
  (`share_presentation`, `unshare_presentation`, the `shared_copy_*` guards).
```

And in "Refusal codes", after `QMPUB`, nothing new (the functions reuse `42501`, `QMREV`, `QMPUB`, `QMBLK`).

- [ ] **Step 3: Apply the migration (ask the user first)**

Ask the user: "May I apply `20261123000000_shared_copy.sql` to the Supabase project now? It deletes every
published teacher presentation." Only on yes: `mcp__claude_ai_Supabase__list_projects` to find the project, then
`apply_migration` with name `shared_copy` and the file's SQL.

- [ ] **Step 4: Run the SQL tests (all rolled back, nothing stays)**

Pick a teacher who isn't an admin and has a presentation with content:

```sql
select p.owner_id, p.id from public.presentations p
where not p.from_admin and p.shared_from is null
  and not exists (select 1 from public.admins a where a.user_id = p.owner_id)
  and public.has_publishable_content(p.id)
limit 1;
```

Then run each test with `execute_sql`, replacing `<T>` (owner id) and `<P>` (presentation id). Each is one
`do` block inside `begin … rollback`, acting as that teacher:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<T>', 'role', 'authenticated')::text, true);
do $$
declare r jsonb; copy text; n int;
begin
  -- T1: Publish makes one published copy with the same slides; the original stays private.
  r := public.share_presentation('<P>');
  copy := r ->> 'id';
  assert (select is_published and shared_from = '<P>' from public.presentations where id = copy), 'T1 copy';
  assert not (select is_published from public.presentations where id = '<P>'), 'T1 original private';
  assert (select count(*) from public.slides where presentation_id = copy)
       = (select count(*) from public.slides where presentation_id = '<P>'), 'T1 slides';

  -- T3: the copy can't be changed directly (row or slides).
  begin
    update public.presentations set title = 'x' where id = copy;
    assert false, 'T3 row change got through';
  exception when sqlstate '42501' then null;
  end;
  begin
    delete from public.slides where presentation_id = copy;
    assert false, 'T3 slide delete got through';
  exception when sqlstate '42501' then null;
  end;

  -- T4: the original can't be published directly.
  begin
    update public.presentations set is_published = true where id = '<P>';
    assert false, 'T4 got through';
  exception when sqlstate '42501' then null;
  end;

  -- T6: Update keeps the copy's id and copies the new title.
  update public.presentations set title = title || ' (new)' where id = '<P>';
  r := public.share_presentation('<P>');
  assert r ->> 'id' = copy, 'T6 same id';
  assert (select title from public.presentations where id = copy) like '% (new)', 'T6 title';

  -- T8: Private removes the copy.
  perform public.unshare_presentation('<P>');
  assert not exists (select 1 from public.presentations where shared_from = '<P>'), 'T8';
  raise notice 'T1 T3 T4 T6 T8 passed';
end $$;
rollback;
```

```sql
-- T2: an old tab that sends isPublished true saves fine and stays private.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<T>', 'role', 'authenticated')::text, true);
do $$
declare p public.presentations;
begin
  select * into p from public.presentations where id = '<P>';
  perform public.save_presentation(
    jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'grades', to_jsonb(p.grades),
      'subject', p.subject, 'curriculum', p.curriculum, 'learningCompetency', p.learning_competency,
      'author', p.author, 'referenceLinks', to_jsonb(p.reference_links), 'isPublished', true, 'fromAdmin', false,
      'createdAt', floor(extract(epoch from p.created_at) * 1000)::bigint, 'slides', '[]'::jsonb),
    array(select s.id from public.slides s where s.presentation_id = p.id order by s.position),
    floor(extract(epoch from p.updated_at) * 1000)::bigint);
  assert not (select is_published from public.presentations where id = '<P>'), 'T2';
  raise notice 'T2 passed';
end $$;
rollback;
```

```sql
-- T5: an admin's hiding stays after Update. T7: deleting the original deletes the copy (cascade).
-- Runs as the database owner (no role switch), with the teacher's claims for auth.uid() in the functions.
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<T>', 'role', 'authenticated')::text, true);
do $$
declare copy text;
begin
  copy := public.share_presentation('<P>') ->> 'id';
  -- Stands in for an admin's hide (only hidden_at changes, which the guard lets through).
  update public.presentations set hidden_at = now() where id = copy;
  perform public.share_presentation('<P>');
  assert (select hidden_at is not null from public.presentations where id = copy), 'T5';
  delete from public.presentations where id = '<P>';
  assert not exists (select 1 from public.presentations where id = copy), 'T7 row';
  assert not exists (select 1 from public.slides where presentation_id = copy), 'T7 slides';
  raise notice 'T5 T7 passed';
end $$;
rollback;
```

Expected: every block prints its "passed" notice; no assertion error. (The rollback undoes the click counts too.)

- [ ] **Step 5: Commit (ask the user first)**

```bash
git add supabase/migrations/20261123000000_shared_copy.sql supabase/migrations/CLAUDE.md
git commit -m "Sharing: a teacher's Publish makes a shared copy (database)"
```

---

### Task 2: Store, loading and the `sharing.ts` helper

**Files:**
- Create: `src/lib/sharing.ts`
- Modify: `src/lib/fetchPresentation.ts`, `src/app/presentation/[id]/edit/page.tsx`,
  `src/app/presentation/[id]/edit/PresentationEditor.tsx`, `src/components/editor/Editor.tsx`, `src/lib/store.ts`,
  `src/lib/CLAUDE.md`

**Interfaces:**
- Consumes: `share_presentation`, `unshare_presentation` (Task 1).
- Produces:
  - `type SharedCopy = { id: string; sharedAt: number }` and `shareCopy(id: string): Promise<SharedCopy>`,
    `unshareCopy(id: string): Promise<void>` in `src/lib/sharing.ts`. Both throw `SaveRefusedError` for a known
    refusal, else the database error.
  - `fetchPresentation(id)` result gains `sharedFrom: string | null` and `sharedCopy: SharedCopy | null`.
  - Store: `sharedCopy: SharedCopy | null`; `setPublished(isPublished: boolean): Promise<boolean>` (teacher path
    changed); new `updateSharedCopy(): Promise<boolean>`.
  - `Editor` / `PresentationEditor` take an optional `sharedCopy?: SharedCopy | null` prop.

- [ ] **Step 1: Create `src/lib/sharing.ts`**

```ts
import { z } from "zod";
import { REFUSALS, SaveRefusedError } from "./presentations";
import { createClient } from "./supabase/client";

// A teacher's shared copy: what other teachers see once it's published (see the shared_copy migration).
// `sharedAt`: when it was last copied from the original (Unix ms).
export type SharedCopy = { id: string; sharedAt: number };

const idSchema = z.string().min(1).max(100);
const sharedCopySchema = z.object({ id: z.string(), sharedAt: z.number() });

function refused(error: { code: string; message: string }): Error {
  return REFUSALS[error.code] ? new SaveRefusedError(REFUSALS[error.code]) : Object.assign(new Error(error.message), error);
}

/** Publish, or "Update shared presentation": copies my saved presentation to its shared copy. */
export async function shareCopy(id: string): Promise<SharedCopy> {
  const { data, error } = await createClient().rpc("share_presentation", { target_id: idSchema.parse(id) });
  if (error) throw refused(error);
  return sharedCopySchema.parse(data);
}

/** Private: removes the shared copy. */
export async function unshareCopy(id: string): Promise<void> {
  const { error } = await createClient().rpc("unshare_presentation", { target_id: idSchema.parse(id) });
  if (error) throw refused(error);
}
```

`Object.assign` keeps `code` and `details`, so `pausedUntilFromError` still reads a `QMBLK` pause.

- [ ] **Step 2: `fetchPresentation.ts` reads the copy**

In `loadPresentation`, add `shared_from` to the select string and return it:
`return { presentation, ownerId: data.owner_id, sharedFrom: data.shared_from as string | null };` (type:
`{ presentation: Presentation; ownerId: string; sharedFrom: string | null } | null`).

In `fetchPresentation`, add to the `Promise.all` (the database only gives back my own copy):

```ts
    // My presentation's shared copy, if it's published (see the shared_copy migration).
    supabase.from("presentations").select("id, shared_at").eq("shared_from", id).maybeSingle(),
```

Destructure it as `{ data: copy }`, add to the return type `sharedFrom: string | null; sharedCopy: SharedCopy | null;`
and to the returned object:

```ts
    sharedFrom: result.sharedFrom,
    sharedCopy: isMine && copy ? { id: copy.id, sharedAt: Date.parse(copy.shared_at) } : null,
```

Update the doc comment: "`sharedFrom`: set when this is a shared copy (the original's id). `sharedCopy`: my
presentation's shared copy, or null."

- [ ] **Step 3: Edit page sends my copy to the original and passes `sharedCopy`**

In `src/app/presentation/[id]/edit/page.tsx`, right after `if (!result) notFound();`:

```tsx
  // My shared copy is edited through its original ("Update shared presentation" copies it again).
  if (result.isMine && result.sharedFrom) redirect(`/presentation/${result.sharedFrom}/edit`);
```

and pass it to the editor: `<PresentationEditor presentation={result.presentation} sentBackNote={sentBackNote} sharedCopy={result.sharedCopy} />`.

In `PresentationEditor.tsx`, add the prop `sharedCopy?: SharedCopy | null` (import type from `@/lib/sharing`),
document it ("`sharedCopy`: my presentation's shared copy, if it's published (see Editor).") and pass it on to
`<Editor … sharedCopy={sharedCopy} />`.

In `Editor.tsx`, add the same prop and, next to `useEditorStore.setState({ review: review ?? null });`:

```tsx
    useEditorStore.setState({ review: review ?? null, sharedCopy: sharedCopy ?? null });
```

and add `sharedCopy` to that effect's dependency list. Add to the doc comment: "`sharedCopy` is my presentation's
shared copy, if it's published (see the shared_copy migration)."

- [ ] **Step 4: Store: `sharedCopy`, the teacher's `setPublished`, `updateSharedCopy`**

In `EditorState` (near `setPublished`):

```ts
  // A teacher's published presentation: its shared copy, which other teachers see (see the shared_copy migration).
  // null = private. QuizMatter presentations don't have one (they use isPublished).
  sharedCopy: SharedCopy | null;
  // Private/published. QuizMatter: the presentation is saved with the switch. A teacher: unsaved edits are saved,
  // then the shared copy is made or removed. True if it worked.
  setPublished: (isPublished: boolean) => Promise<boolean>;
  // "Update shared presentation": saves unsaved edits, then copies the presentation to its shared copy again.
  updateSharedCopy: () => Promise<boolean>;
```

Initial value `sharedCopy: null,` next to `review: null,` (the state defaults), and in `loadPresentation`'s
`set({...})` add `sharedCopy: null,` (Editor sets it right after).

Replace `setPublished` with:

```ts
  setPublished: async (isPublished) => {
    const { presentation, saveStatus, setPresentationDetails, savePresentation } = get();
    if (saveStatus === "saving") return false;
    if (!presentation.fromAdmin) {
      if (!(await savePresentation({ quiet: true }))) return false;
      try {
        if (isPublished) set({ sharedCopy: await shareCopy(presentation.id) });
        else {
          await unshareCopy(presentation.id);
          set({ sharedCopy: null });
        }
        return true;
      } catch (error) {
        console.error("Couldn't change sharing", error);
        if (pausedUntilFromError(error as { code?: string; details?: string })) await checkPauses();
        return false;
      }
    }
    setPresentationDetails({ isPublished });
    const switched = get().presentation;
    // Quiet: the Share button shows its own message (published / private / couldn't change it).
    if (await savePresentation({ quiet: true })) return true;
    // Switch back. With no other edits since, put the old presentation object back, so it doesn't count as unsaved.
    if (get().presentation === switched) withoutHistory(() => set({ presentation }));
    else setPresentationDetails({ isPublished: presentation.isPublished });
    return false;
  },

  updateSharedCopy: async () => get().setPublished(true),
```

(`updateSharedCopy` is the same steps as Publish; the database updates the copy when there is one.) Import
`shareCopy`, `unshareCopy` and `type SharedCopy` from `./sharing`. A refused share returns `false` and the Share
card shows its own toast. The empty-presentation message (QMPUB) is told before calling: the card checks
`publishableSchema` first (it already does for Publish; Task 3 adds it for Update).

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no errors (the Share card still compiles: it only reads `isPublished` and `setPublished`).

- [ ] **Step 6: Note in `src/lib/CLAUDE.md`**

Add a short section (next to the saving notes):

```markdown
## Sharing (shared copy)

`sharing.ts`: `shareCopy(id)` (Publish and "Update shared presentation") and `unshareCopy(id)` (Private) call
`share_presentation` / `unshare_presentation` (zod first). The copy is its own presentation row with `shared_from`
= the original; `fetchPresentation` returns `sharedCopy` for my original and `sharedFrom` for a copy. The store
keeps `sharedCopy`; `setPublished` / `updateSharedCopy` save unsaved edits first. QuizMatter presentations keep the
`isPublished` switch. See `supabase/migrations/20261123000000_shared_copy.sql`.
```

- [ ] **Step 7: Commit (ask the user first)**

```bash
git add src/lib/sharing.ts src/lib/fetchPresentation.ts "src/app/presentation/[id]/edit/page.tsx" "src/app/presentation/[id]/edit/PresentationEditor.tsx" src/components/editor/Editor.tsx src/lib/store.ts src/lib/CLAUDE.md
git commit -m "Sharing: the editor loads and changes the shared copy"
```

---

### Task 3: The Share card

**Files:**
- Modify: `src/components/editor/ShareButton.tsx`, `src/components/editor/CLAUDE.md`

**Interfaces:**
- Consumes: store `sharedCopy`, `setPublished`, `updateSharedCopy`, `savedAt`, `savedPresentation` (Task 2).

- [ ] **Step 1: New teacher confirm text**

Replace `TEACHER_CONFIRM` with:

```ts
const TEACHER_CONFIRM = {
  published: {
    title: "Publish this presentation?",
    points: [
      "Other teachers get a copy of it as it is now. They can find it on the Home page and open it.",
      "They can make their own copy of it, save it to their “Saved” list, or report it.",
      "Edits you make later stay private until you click “Update shared presentation”.",
      "Your unsaved edits are saved first.",
    ],
  },
  private: {
    title: "Make this presentation private?",
    points: [
      "The shared copy is removed. It leaves the Home page and other teachers’ “Saved” lists.",
      "Its link stops working for other teachers.",
      "Copies other teachers already made stay with them.",
      "Your unsaved edits are saved too.",
    ],
  },
};
```

- [ ] **Step 2: Read the state and add the Update action**

Replace `const isPublished = useEditorStore((s) => s.presentation.isPublished);` with:

```ts
  const fromAdmin = useEditorStore((s) => s.presentation.fromAdmin);
  const sharedCopy = useEditorStore((s) => s.sharedCopy);
  // A teacher's presentation is published when it has a shared copy; a QuizMatter one has the switch.
  const isPublished = useEditorStore((s) => (s.presentation.fromAdmin ? s.presentation.isPublished : s.sharedCopy !== null));
  // Has edits the shared copy doesn't have: unsaved ones, or saved after the last copy.
  const isBehind = useEditorStore(
    (s) => s.sharedCopy !== null && (s.presentation !== s.savedPresentation || (s.savedAt ?? 0) > s.sharedCopy.sharedAt),
  );
  const updateSharedCopy = useEditorStore((s) => s.updateSharedCopy);
  const [isUpdating, setIsUpdating] = useState(false);
```

(remove the old `fromAdmin` line further down, it moved up). Add:

```ts
  const update = async () => {
    // Checked here first, so the teacher is told at once (the database checks it too).
    const problem = publishableSchema.safeParse(useEditorStore.getState().presentation).error;
    if (problem) return toast.error(problem.issues[0].message);
    setIsUpdating(true);
    const updated = await updateSharedCopy();
    setIsUpdating(false);
    // Paused for switching too often: the notice at the bottom says until when.
    if (!updated && isPaused("share")) return;
    if (updated) toast.success("Shared copy updated — other teachers see your newest version.");
    else toast.error("Couldn't update the shared copy. Please try again.");
  };
```

`copyLink` uses the copy's link for a teacher:

```ts
      await navigator.clipboard.writeText(`${window.location.origin}/presentation/${sharedCopy?.id ?? id}`);
```

- [ ] **Step 3: The up-to-date / behind line and the button**

Inside the open card, right before `{isPublished && (` (the Copy link button), add (teachers only):

```tsx
          {sharedCopy && (
            <div className="flex flex-col gap-2 rounded-button bg-bg-page px-3 py-2.5">
              <p className="flex items-center gap-2 text-[13px] text-text-secondary">
                {isBehind ? <CircleAlertIcon size={14} className="shrink-0 text-highlight-strong" /> : <CheckIcon size={14} className="shrink-0 text-success-strong" />}
                {isBehind ? "You have changes the shared copy doesn’t have." : "The shared copy is up to date."}
              </p>
              {isBehind && (
                <button
                  type="button"
                  onClick={update}
                  disabled={isUpdating || isSaving || isSharePaused}
                  className="inline-flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {isUpdating ? <Spinner size={14} /> : <RefreshCwIcon size={14} />}
                  Update shared presentation
                </button>
              )}
            </div>
          )}
```

Import `CircleAlertIcon`, `RefreshCwIcon` from `lucide-react`. When the Update button shows, make Copy link the
plain bordered style so there's one main button:
`className={sharedCopy && isBehind ? "flex items-center justify-center gap-2 rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page" : "<today's main-button classes>"}`.

Update the component's doc comment: a teacher's Published makes a shared copy; the card says whether the copy is
up to date and offers "Update shared presentation".

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors in the changed files.

- [ ] **Step 5: Note in `src/components/editor/CLAUDE.md`**

Where the Share card is described (search "ShareButton"; add a line if it isn't), write:

```markdown
- Share card (`ShareButton.tsx`): a teacher's Published = a shared copy (store `sharedCopy`). It says "up to date"
  or "You have changes the shared copy doesn't have" (unsaved edits, or saved after `sharedCopy.sharedAt`) with
  "Update shared presentation". QuizMatter presentations keep the Draft / Shared switch.
```

- [ ] **Step 6: Commit (ask the user first)**

```bash
git add src/components/editor/ShareButton.tsx src/components/editor/CLAUDE.md
git commit -m "Sharing: Share card says if the shared copy is up to date, with Update"
```

---

### Task 4: My lists, delete text, Move to QuizMatter

**Files:**
- Modify: `src/app/(home)/cards.ts`, `src/app/(home)/page.tsx`, `src/app/(home)/search/page.tsx`,
  `src/app/(home)/layout.tsx`, `src/app/presentations/page.tsx`, `src/app/PresentationCardMenu.tsx`,
  `src/app/presentations/PresentationList.tsx`, `src/app/admin/presentations/actions.ts`, `src/app/CLAUDE.md`

**Interfaces:**
- Produces: `mySharedCopies(supabase: SupabaseClient): Promise<Map<string, { hiddenAt: string | null }>>` in
  `cards.ts` (key = the original's id); `myCard(p, canMove, now, extra)` gains `extra.sharedCopy?: { hiddenAt: string | null }`.

- [ ] **Step 1: `cards.ts`: the helper and the badge**

```ts
/** My shared copies by their original's id (see the shared_copy migration): my published presentations. */
export async function mySharedCopies(supabase: SupabaseClient): Promise<Map<string, { hiddenAt: string | null }>> {
  const me = await myId(supabase);
  const { data, error } = await supabase.from("presentations").select("shared_from, hidden_at").eq("owner_id", me).not("shared_from", "is", null);
  if (error) throw error;
  return new Map(data.map((row) => [row.shared_from as string, { hiddenAt: row.hidden_at as string | null }]));
}
```

In `myCard`, `extra` becomes `{ isEditor: boolean; submission?: SubmissionStatus; sharedCopy?: { hiddenAt: string | null } }`
and the badge:

```ts
    // Published = it has a shared copy; hidden = an admin hid that copy (other teachers can't see it).
    badge: extra.sharedCopy?.hiddenAt ? ("hidden" as const) : extra.sharedCopy ? ("published" as const) : undefined,
```

and `canSubmit` uses `!extra.sharedCopy?.hiddenAt` instead of `!p.hidden_at`.

- [ ] **Step 2: My own queries leave copies out**

Add `.is("shared_from", null)` to:
- `src/app/(home)/layout.tsx:56`: `count().eq("owner_id", me).eq("from_admin", false).is("shared_from", null),`
- `src/app/(home)/page.tsx:22`: `….eq("owner_id", me).eq("from_admin", false).is("shared_from", null)`
- `src/app/(home)/search/page.tsx:24`: `isMine ? base.eq("owner_id", me).eq("from_admin", false).is("shared_from", null)`
- `src/app/presentations/page.tsx`: after `.eq("from_admin", false)`.

In `(home)/page.tsx` and `search/page.tsx`, add `mySharedCopies(supabase)` to the existing `Promise.all` (search:
only when `isMine`, else `new Map()`), and pass `sharedCopy: sharedCopyOf.get(presentation.id)` in the `myCard(…)`
`extra`. In `presentations/page.tsx`, add `mySharedCopies(supabase)` to its `Promise.all`, pass the map to
`buildRows`, and set `isPublished: sharedCopyOf.has(presentation.id)` (drop `is_published` from its select and type).

- [ ] **Step 3: Delete confirm says the copy goes too**

`PresentationCardMenu.tsx` delete message (non-draft):

```tsx
`"${card.title}" is deleted for good. This can't be undone.${card.badge === "published" || card.badge === "hidden" ? " Its shared copy is removed too: other teachers lose it." : ""}`
```

`PresentationList.tsx` delete message (non-draft): same, with `row.isPublished`.

- [ ] **Step 4: Move to QuizMatter removes the copy first**

In `moveToQuizMatter` (`src/app/admin/presentations/actions.ts`), before the update:

```ts
  // A QuizMatter presentation has no shared copy (its Shared switch is the presentation itself).
  const removed = await supabase.from("presentations").delete().eq("shared_from", parsed.data).eq("owner_id", claims?.claims.sub ?? "");
  if (removed.error) return false;
```

- [ ] **Step 5: Type check and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors in the changed files.

- [ ] **Step 6: Notes in `src/app/CLAUDE.md`**

Replace the "Sharing and publishing" section with:

```markdown
## Sharing and publishing

A teacher's Published makes a **shared copy**: its own presentation row (`shared_from` = the original), which other
teachers see. The teacher keeps editing the original in private; "Update shared presentation" in the Share card
(`src/components/editor/ShareButton.tsx`) copies it again (same link, bookmarks and reports). Private, or deleting
the original, removes the copy. Only `share_presentation` / `unshare_presentation` change a copy
(`20261123000000_shared_copy.sql`; app side: `src/lib/sharing.ts`). My own lists leave copies out
(`shared_from is null`) and show Published / Hidden from the copy (`mySharedCopies` in `(home)/cards.ts`); opening
my copy's editor goes to the original. Limits: the `share` and `publish` click limits, and it needs a title and one
slide with something on it (`QMPUB`, same rule as `publishableSchema`). QuizMatter (admin) presentations keep their
Draft / Shared switch on the presentation itself, and aren't counted.
```

- [ ] **Step 7: Commit (ask the user first)**

```bash
git add "src/app/(home)/cards.ts" "src/app/(home)/page.tsx" "src/app/(home)/search/page.tsx" "src/app/(home)/layout.tsx" src/app/presentations/page.tsx src/app/PresentationCardMenu.tsx src/app/presentations/PresentationList.tsx src/app/admin/presentations/actions.ts src/app/CLAUDE.md
git commit -m "Sharing: my lists show the original, with Published from its shared copy"
```

---

### Task 5: Final checks and browser test

**Files:** none new (fixes only).

- [ ] **Step 1: Checks**

Run: `npx tsc --noEmit` and `npm run lint`. Read `git diff 5c59441..HEAD` next to the spec: every spec part done,
nothing extra, zod before rpc, one Spinner, design classes, notes true (root `CLAUDE.md` map needs no new line:
no new folder).

- [ ] **Step 2: Browser test (the user asked for testing)**

Start the dev server (`npm run dev`, background), open it in a new Chrome tab, log in as a teacher (ask the user
to log in if needed). Then:
- B1: New presentation with a title and a question → Share → Published → Continue. Toast "published"; card shows
  "The shared copy is up to date."
- B2: Reload the editor → card still "up to date" (save time vs copy time compare right).
- B3: Change the title, don't save → card says "You have changes…" + Update. Click Update → spinner, toast,
  "up to date".
- B4: Copy link → open the link → the view page shows the updated title.
- B5: Home "My presentations" shows the presentation once, with the Published badge; the tab count didn't grow by 2.
- B6: Open `/presentation/<copy id>/edit` → lands on `/presentation/<original id>/edit`.
- B7: Share → Private → Continue → the copy link now shows "not found".
- B8: Delete the presentation (after publishing again) → the confirm text mentions the shared copy.

Report each result to the user, with any failure's console output (`read_console_messages`).

- [ ] **Step 3: Commit fixes (ask the user first)**
