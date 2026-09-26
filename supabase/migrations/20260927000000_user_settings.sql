-- One row of settings per user. For now it holds the Elements panel categories they starred as
-- favorites, so the Favorites section follows them to any device.

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  favorite_element_categories text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Each user can only see and change their own settings row.
alter table public.user_settings enable row level security;

create policy "Own settings" on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
