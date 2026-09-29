-- A small list of which slide uses which photo, so the photo cleanup (and the admin page "Photo cleanup")
-- doesn't have to search every slide each time. See docs/photo-cleanup.md.
--
-- The list keeps itself up to date: each time a slide's data is saved, a trigger reads that one slide and
-- rewrites its rows, but only if its photos changed. Rows go away with their slide.

create table public.slide_photos (
  presentation_id text not null,
  slide_id text not null,
  src text not null,
  primary key (presentation_id, slide_id, src),
  foreign key (presentation_id, slide_id) references public.slides (presentation_id, id)
    on update cascade on delete cascade
);

-- No rules, so teachers can't read or change it. Only the trigger and the cleanup functions use it.
alter table public.slide_photos enable row level security;

-- The photo addresses in one slide's data, sorted, each once.
create function public.slide_photo_srcs(data jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}')
  from regexp_matches(data::text, 'https://images\.quizmatter\.com/uploads/[0-9a-f]{64}\.(?:webp|jpg)', 'g') as m;
$$;

-- "security definer" lets it write the list for any teacher's save (the list has no rules for teachers).
create function public.sync_slide_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_srcs text[] := public.slide_photo_srcs(new.data);
  old_srcs text[];
begin
  select coalesce(array_agg(sp.src order by sp.src), '{}') into old_srcs
  from public.slide_photos sp
  where sp.presentation_id = new.presentation_id and sp.slide_id = new.id;

  -- Same photos as before (e.g. only the words changed): nothing to write.
  if new_srcs = old_srcs then
    return null;
  end if;

  delete from public.slide_photos sp where sp.presentation_id = new.presentation_id and sp.slide_id = new.id;
  insert into public.slide_photos (presentation_id, slide_id, src)
  select new.presentation_id, new.id, unnest(new_srcs);
  return null;
end;
$$;

create trigger sync_slide_photos
after insert or update of data on public.slides
for each row execute function public.sync_slide_photos();

-- Fill the list once from the slides there are now.
insert into public.slide_photos (presentation_id, slide_id, src)
select s.presentation_id, s.id, unnest(public.slide_photo_srcs(s.data))
from public.slides s;

-- The cleanup now reads the list instead of searching every slide.
create or replace function public.used_photo_srcs()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct used.src), '{}')
  from (
    select p.src from public.photos p
    union
    select sp.src from public.shared_photos sp
    union
    select slp.src from public.slide_photos slp
  ) as used (src);
$$;
