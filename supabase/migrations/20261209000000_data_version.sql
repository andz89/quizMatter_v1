-- Data version: an editor tab still running older app code can't save over data written by newer code (it would
-- quietly drop fields it doesn't know). The app sends its DATA_VERSION (src/lib/schema.ts) with every save; each
-- presentation and review draft keeps the highest version that saved it. A save from a lower version is refused
-- (QMOLD); the app then keeps the unsaved work in the browser and asks for a reload. Tabs from before this change
-- send none and count as 0, the same as today's app, so this change itself refuses nobody.
-- Spec: docs/superpowers/specs/2026-10-23-stable-presentation-data-design.md

-- ─── 0. Catching up 20261102000000_review_auto_reviewer.sql ──────────────────────────────────────────────
-- That file never reached the live database (found 2026-10-23): submit_review still took the typed "Reviewed by"
-- fields, and presentation_reviewers still had its required background column, which today's publish_review
-- doesn't fill. Its other part (an older publish_review) must not run again, so only these two steps are repeated,
-- written to work whether or not the file ran. submit_review itself is made again in section 3.
drop function if exists public.submit_review(text, jsonb, jsonb, bigint);
drop function if exists public.admin_reviewers();
alter table public.presentation_reviewers drop column if exists background;

-- admin_reviewers(): same as 20261102000000_review_auto_reviewer.sql §4 (without the background).
create function public.admin_reviewers()
returns table (
  presentation_id text,
  name text,
  email text,
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
    r.reviewed_on,
    r.approved_at,
    coalesce(s.display_name, ''),
    coalesce(u.email, '')
  from public.presentation_reviewers r
  left join public.user_settings s on s.user_id = r.approved_by
  left join auth.users u on u.id = r.approved_by
  where public.is_admin()
  order by r.reviewed_on desc, r.approved_at desc nulls last;
$$;

revoke execute on function public.admin_reviewers() from public, anon;
grant execute on function public.admin_reviewers() to authenticated;

-- ─── 1. The versions ──────────────────────────────────────────────────────────────────────────────────────
alter table public.presentations add column data_version int not null default 0;
alter table public.presentation_reviews add column draft_version int not null default 0;

-- ─── 2. save_presentation: same as before (20261201000000_editor_author_and_copy_source.sql), plus the version ─
drop function public.save_presentation(jsonb, text[], bigint);

create function public.save_presentation(presentation jsonb, slide_ids text[], base_updated_at bigint, app_version int default 0)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := presentation ->> 'id';
  saved_updated_at timestamptz;
  saved_version int;
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
  select p.updated_at, p.data_version into saved_updated_at, saved_version
  from public.presentations p where p.id = target_id for update;
  -- Checked before the conflict below, so an old tab always gets this one (the app keeps its work).
  if found and coalesce(app_version, 0) < saved_version then
    raise exception 'QuizMatter was updated. Reload the page.' using errcode = 'QMOLD';
  end if;
  if found and (base_updated_at is null or floor(extract(epoch from saved_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This presentation was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;

  insert into public.presentations (
    id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at, copied_from, data_version
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
    nullif(presentation ->> 'copiedFrom', ''),
    coalesce(app_version, 0)
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
    data_version = greatest(public.presentations.data_version, excluded.data_version),
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

revoke execute on function public.save_presentation(jsonb, text[], bigint, int) from public, anon;
grant execute on function public.save_presentation(jsonb, text[], bigint, int) to authenticated;

-- ─── 3. Review drafts ─────────────────────────────────────────────────────────────────────────────────────
-- A draft starts from the live presentation, so an app older than either the draft or the presentation is refused.
create function public.check_review_version(review public.presentation_reviews, app_version int)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(app_version, 0) < greatest(
    review.draft_version,
    (select p.data_version from public.presentations p where p.id = review.presentation_id)
  ) then
    raise exception 'QuizMatter was updated. Reload the page.' using errcode = 'QMOLD';
  end if;
end;
$$;
revoke execute on function public.check_review_version(public.presentation_reviews, int) from public, anon, authenticated;

-- save_review_draft: same as before (20261019000000_presentation_reviews.sql), plus the version.
drop function public.save_review_draft(text, jsonb, bigint);

create function public.save_review_draft(target_id text, review_draft jsonb, base_updated_at bigint, app_version int default 0)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews := public.my_open_review(target_id);
begin
  perform public.check_review_version(review, app_version);
  if review.draft_updated_at is not null
    and (base_updated_at is null or floor(extract(epoch from review.draft_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This draft was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  perform public.check_review_draft(target_id, review_draft);

  update public.presentation_reviews set
    draft = review_draft,
    draft_updated_at = now(),
    draft_version = greatest(draft_version, coalesce(app_version, 0))
  where presentation_id = target_id;
  return floor(extract(epoch from now()) * 1000)::bigint;
end;
$$;

revoke execute on function public.save_review_draft(text, jsonb, bigint, int) from public, anon;
grant execute on function public.save_review_draft(text, jsonb, bigint, int) to authenticated;

-- submit_review: same as before (20261102000000_review_auto_reviewer.sql), plus the version. "if exists": live, the
-- older one (section 0) was there instead.
drop function if exists public.submit_review(text, jsonb, date, bigint);

create function public.submit_review(target_id text, review_draft jsonb, reviewed_on date, base_updated_at bigint, app_version int default 0)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews := public.my_open_review(target_id);
  reviewer_email text;
  reviewer_name text;
begin
  perform public.check_review_version(review, app_version);
  if review.draft_updated_at is not null
    and (base_updated_at is null or floor(extract(epoch from review.draft_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This draft was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  perform public.check_review_draft(target_id, review_draft);
  -- The reviewer's "today": one day either side of the server's, for time zones ahead of or behind UTC.
  if reviewed_on is null or reviewed_on not between current_date - 1 and current_date + 1 then
    raise exception 'The review date isn''t valid.' using errcode = '22023';
  end if;

  select u.email into reviewer_email from auth.users u where u.id = auth.uid();
  if coalesce(reviewer_email, '') = '' then
    raise exception 'Your account has no email.' using errcode = '22023';
  end if;
  select coalesce(nullif(trim(s.display_name), ''), split_part(reviewer_email, '@', 1)) into reviewer_name
  from (select 1) as one
  left join public.user_settings s on s.user_id = auth.uid();

  update public.presentation_reviews set
    draft = review_draft,
    draft_updated_at = now(),
    draft_version = greatest(draft_version, coalesce(app_version, 0)),
    submitted_fields = jsonb_build_object(
      'name', left(reviewer_name, 100),
      'email', reviewer_email,
      'reviewedOn', reviewed_on
    ),
    status = 'submitted',
    submitted_at = now(),
    admin_note = null
  where presentation_id = target_id;
end;
$$;

revoke execute on function public.submit_review(text, jsonb, date, bigint, int) from public, anon;
grant execute on function public.submit_review(text, jsonb, date, bigint, int) to authenticated;

-- ─── 4. publish_review: same as before (20261202000000_author_updates.sql), plus the draft's version ────────
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
  if exists (select 1 from public.banned_users b where b.user_id = review.reviewer_id) then
    raise exception 'This reviewer is banned, so their review can''t be published.' using errcode = 'QMBRV';
  end if;
  d := review.draft;
  f := review.submitted_fields;

  -- Lets the lock triggers through for these changes only (until this transaction ends).
  perform set_config('quizmatter.publishing_review', 'yes', true);

  update public.presentations p set
    title = d ->> 'title',
    description = d ->> 'description',
    grades = public.grades_from(d),
    subject = d ->> 'subject',
    -- A draft saved before Term existed has none: keep it empty.
    term = coalesce(d ->> 'term', ''),
    -- A draft saved before Week and Day existed has none: keep them empty.
    week = coalesce(d ->> 'week', ''),
    day = coalesce(d ->> 'day', ''),
    curriculum = d ->> 'curriculum',
    learning_competency = d ->> 'learningCompetency',
    reference_links = array(select jsonb_array_elements_text(d -> 'referenceLinks')),
    tags = array(select jsonb_array_elements_text(coalesce(d -> 'tags', '[]'))),
    transition = coalesce(d ->> 'transition', 'slide'),
    transition_speed = coalesce((d ->> 'transitionSpeed')::smallint, 3),
    -- The draft becomes the presentation, so its version does too.
    data_version = greatest(p.data_version, review.draft_version),
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

  -- The lesson's own editor updating it isn't a reviewer: no "Reviewed by" row, and other editors' access stays as
  -- it was (no last_reviewer_id change).
  if not review.is_author_update then
  insert into public.presentation_reviewers (
    presentation_id, reviewer_id, name, email, reviewed_on, approved_by, approved_at
  )
  values (
    target_id, review.reviewer_id, f ->> 'name', f ->> 'email', (f ->> 'reviewedOn')::date,
    auth.uid(), now()
  )
  on conflict (presentation_id, reviewer_id) do update set
    name = excluded.name,
    email = excluded.email,
    reviewed_on = excluded.reviewed_on,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at;
  end if;

  update public.presentation_reviews set
    status = 'published',
    ended_at = now(),
    last_reviewer_id = case when review.is_author_update then last_reviewer_id else review.reviewer_id end,
    draft = null,
    draft_updated_at = null,
    draft_version = 0,
    submitted_fields = null,
    admin_note = null
  where presentation_id = target_id;
end;
$$;

-- ─── 5. approve_submission: same as before (20261201000000_editor_author_and_copy_source.sql), plus the version ─
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
    author, reference_links, tags, transition, transition_speed, is_published, from_admin, data_version
  )
  select
    new_id, auth.uid(), p.title, p.description, p.grades, p.subject, p.term, p.week, p.day, p.curriculum,
    p.learning_competency,
    -- Always the editor (never what the Author field says). Same limit as DETAIL_MAX_LENGTH.author in src/lib/schema.ts.
    left(coalesce(editor_name, ''), 120),
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
