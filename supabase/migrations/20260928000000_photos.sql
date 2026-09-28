-- The photos each teacher uploaded (or added from a link), for the "My photos" list in the Photos panel.
-- The files themselves live in the R2 bucket "quizmatter-images"; a row only remembers one.
-- Removing a row only takes the photo off the list: slides that use it keep it.

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  src text not null check (src like 'https://images.quizmatter.com/uploads/%' and length(src) <= 300),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now(),
  -- The same photo uploaded twice is listed once (it moves back to the top instead).
  unique (user_id, src)
);

-- The list shows each teacher's newest photos first.
create index photos_user_newest on public.photos (user_id, created_at desc);

-- Each user can only see and change their own photos.
alter table public.photos enable row level security;

create policy "Own photos" on public.photos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
