-- Folders: a teacher sorts their own presentations into folders ("Week 3", "Grade 4 – Fractions"). Personal:
-- nobody else sees them. A presentation is in one folder at most. Kept in their own tables, not on
-- presentations, so moving one isn't an edit of it (it works during a review lock, and an open editor tab
-- doesn't get "saved somewhere else").
--
-- Error code the app shows a message for: QMFLD = too many folders.

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Same limit as FOLDER_NAME_MAX in src/lib/folders.ts (zod checks it there first).
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);

-- A teacher's folder names are unique, ignoring case ("Week 3" and "week 3" are the same).
create unique index folders_owner_name_idx on public.folders (owner_id, lower(name));

-- presentation_id is the key, so a presentation is in one folder at most. Deleting the folder or the
-- presentation deletes the row: a deleted folder's presentations stay, in no folder.
create table public.folder_items (
  presentation_id text primary key references public.presentations (id) on delete cascade,
  folder_id uuid not null references public.folders (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade
);

create index folder_items_folder_id_idx on public.folder_items (folder_id);
create index folder_items_owner_id_idx on public.folder_items (owner_id);

alter table public.folders enable row level security;
alter table public.folder_items enable row level security;

-- Teachers only see and change their own folders.
create policy "Own folders" on public.folders
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Read own folder items" on public.folder_items
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Remove own folder items" on public.folder_items
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- …and only put their own presentation in their own folder (insert, and update for moving).
create policy "Add own folder items" on public.folder_items
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = (select auth.uid()))
    and exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = (select auth.uid()))
  );

create policy "Move own folder items" on public.folder_items
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = (select auth.uid()))
    and exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = (select auth.uid()))
  );

-- At most 50 folders per teacher (same as MAX_FOLDERS in src/lib/folders.ts), and none for banned teachers.
create function public.check_folder_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  if (select count(*) from public.folders f where f.owner_id = new.owner_id) >= 50 then
    raise exception 'You have 50 folders, the most allowed.' using errcode = 'QMFLD';
  end if;
  return new;
end;
$$;

create trigger folder_limit
  before insert on public.folders
  for each row execute function public.check_folder_limit();
