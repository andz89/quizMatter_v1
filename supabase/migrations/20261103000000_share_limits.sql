-- Stops abusive sharing of teachers' own presentations (Admin → Safety lists all three):
--
-- 1. "share" click limit: every private ↔ published switch counts. 12 in an hour pauses sharing for 1 hour (6 hours
--    if it happens again within 24 hours). No ban.
-- 2. "publish" click limit: only private → published counts (also a presentation saved published the first time).
--    10 in a day pauses publishing for 24 hours. No ban. Going back to private still works then.
-- 3. Content: a presentation can only become published with a title and at least one slide with something on it
--    (question or answer text, an element, or a video / slides link). Error QMPUB. Same rule as publishableSchema
--    in src/lib/schema.ts.
--
-- Both limits use the one click limit system (20261013000000_click_limits.sql). Admins and QuizMatter presentations
-- (from_admin) aren't counted or checked.

-- ─── 1. The limits ────────────────────────────────────────────────────────────────────────────────────────
insert into public.click_limits
  (feature, label, max_clicks, per_seconds, first_pause_minutes, repeat_pause_minutes, repeat_within_hours, ban_after_pauses)
values
  ('share', 'Share (private / published)', 12, 3600, 60, 360, 24, null),
  ('publish', 'Publish', 10, 86400, 1440, 1440, 24, null);

-- ─── 2. Does it have something to publish? ────────────────────────────────────────────────────────────────
create function public.has_publishable_content(target_id text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.presentations p
    where p.id = target_id and btrim(p.title) <> ''
  ) and exists (
    select 1 from public.slides s
    where s.presentation_id = target_id and (
      btrim(coalesce(s.data ->> 'question', '')) <> ''
      or jsonb_array_length(coalesce(s.data -> 'elements', '[]')) > 0
      or coalesce(s.data ->> 'embedUrl', '') <> ''
      or btrim(coalesce(s.data ->> 'correctAnswer', '')) <> ''
      or exists (select 1 from jsonb_array_elements(coalesce(s.data -> 'options', '[]')) o where btrim(coalesce(o ->> 'text', '')) <> '')
    )
  );
$$;

revoke execute on function public.has_publishable_content(text) from public, anon;
grant execute on function public.has_publishable_content(text) to authenticated;

-- ─── 3. Counting the switches ─────────────────────────────────────────────────────────────────────────────
create function public.count_share_clicks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.from_admin
    or (tg_op = 'INSERT' and not new.is_published)
    or (tg_op = 'UPDATE' and new.is_published = old.is_published) then
    return new;
  end if;
  perform public.count_click('share');
  if new.is_published then
    perform public.count_click('publish');
    -- save_presentation checks the content itself, after it saves the slides. A plain update of the row (not
    -- through it) changes no slides, so the saved ones are checked here.
    if coalesce(current_setting('quizmatter.saving_presentation', true), '') <> 'yes'
      and not public.is_admin()
      and not public.has_publishable_content(new.id) then
      raise exception 'Add a title and some content before publishing.' using errcode = 'QMPUB';
    end if;
  end if;
  return new;
end;
$$;

create trigger count_share_clicks
  before insert or update of is_published on public.presentations
  for each row execute function public.count_share_clicks();

-- ─── 4. save_presentation: checks the content when it becomes published ───────────────────────────────────
-- Same as before (20261031000000_multiple_grades.sql); only was_published, the saving_presentation setting and the
-- content check at the end are new.
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
  was_published boolean := false;
begin
  -- Tells the share trigger (below) that this function checks the content itself, once the slides are saved.
  perform set_config('quizmatter.saving_presentation', 'yes', true);

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
  select p.updated_at, p.is_published into saved_updated_at, was_published from public.presentations p where p.id = target_id for update;
  if found and (base_updated_at is null or floor(extract(epoch from saved_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This presentation was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;

  insert into public.presentations (
    id, title, description, grades, subject, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at
  )
  values (
    target_id,
    presentation ->> 'title',
    presentation ->> 'description',
    public.grades_from(presentation),
    presentation ->> 'subject',
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
    (presentation ->> 'isPublished')::boolean,
    coalesce((presentation ->> 'fromAdmin')::boolean, false),
    to_timestamp((presentation ->> 'createdAt')::bigint / 1000.0),
    now()
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    grades = excluded.grades,
    subject = excluded.subject,
    curriculum = excluded.curriculum,
    learning_competency = excluded.learning_competency,
    author = excluded.author,
    reference_links = excluded.reference_links,
    tags = excluded.tags,
    transition = excluded.transition,
    transition_speed = excluded.transition_speed,
    is_published = excluded.is_published,
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

  -- Becoming published: it needs a title and some content (checked now, on the newest slides).
  if (presentation ->> 'isPublished')::boolean and not coalesce(was_published, false)
    and not (select p.from_admin from public.presentations p where p.id = target_id)
    and not public.is_admin()
    and not public.has_publishable_content(target_id) then
    raise exception 'Add a title and some content before publishing.' using errcode = 'QMPUB';
  end if;

  perform set_config('quizmatter.saving_presentation', '', true);

  return floor(extract(epoch from now()) * 1000)::bigint;
end;
$$;
