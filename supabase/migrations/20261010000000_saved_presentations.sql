-- "Save" (like YouTube's): a teacher bookmarks another teacher's or QuizMatter's published presentation, and it
-- shows in the "Saved" row on their home page. It's a link to the original, not a copy: they always see its
-- newest version, and it leaves the list when the owner deletes or unpublishes it, or an admin hides it (the
-- "Read published presentations" policy already hides those).
--
-- Error code the app shows a message for: QMSAV = too many saved presentations.

create table public.saved_presentations (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  presentation_id text not null references public.presentations (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, presentation_id)
);

-- The home page's "Saved" row: newest saved first.
create index saved_presentations_user_saved_at_idx on public.saved_presentations (user_id, saved_at desc);
-- Deleting a presentation removes its saved rows.
create index saved_presentations_presentation_id_idx on public.saved_presentations (presentation_id);

alter table public.saved_presentations enable row level security;

-- Teachers only see and remove their own saved rows.
create policy "Read own saved presentations" on public.saved_presentations
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Remove own saved presentations" on public.saved_presentations
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- …and only save someone else's presentation that they can see (published and not hidden).
create policy "Save other people's presentations" on public.saved_presentations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.presentations p
      where p.id = presentation_id and p.is_published and p.hidden_at is null and p.owner_id <> (select auth.uid())
    )
  );

-- At most 500 saved presentations per teacher (against spam), and none for banned teachers.
create function public.check_saved_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  if (select count(*) from public.saved_presentations s where s.user_id = new.user_id) >= 500 then
    raise exception 'You have 500 saved presentations, the most allowed.' using errcode = 'QMSAV';
  end if;
  return new;
end;
$$;

create trigger saved_limit
  before insert on public.saved_presentations
  for each row execute function public.check_saved_limit();
