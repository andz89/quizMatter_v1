-- Shared photos: photos an admin uploads for every teacher to use, sorted into categories.
-- The files live in the R2 bucket "quizmatter-images" (like "My photos"); a row only remembers one.

-- Who is an admin. Add a user by hand in the SQL editor:
--   insert into public.admins (user_id) values ('<the user id from Authentication → Users>');
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- No policies: nobody reads or changes this table through the API. is_admin() reads it for them.
alter table public.admins enable row level security;

-- True when the logged-in user is an admin. "security definer" lets it read the admins table.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.photo_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);

-- "Animals" and "animals" count as the same name.
create unique index photo_categories_name on public.photo_categories (lower(name));

create table public.shared_photos (
  src text primary key check (src like 'https://images.quizmatter.com/uploads/%.webp' and length(src) <= 300),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  -- A category with photos can't be deleted (its photos must be removed first).
  category_id uuid not null references public.photo_categories (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- The list shows the newest photos first.
create index shared_photos_newest on public.shared_photos (created_at desc);
create index shared_photos_category on public.shared_photos (category_id);

-- Every logged-in teacher can see them; only admins can add, change or remove them.
alter table public.photo_categories enable row level security;
alter table public.shared_photos enable row level security;

create policy "Everyone reads categories" on public.photo_categories
  for select to authenticated using (true);
create policy "Admins change categories" on public.photo_categories
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Everyone reads shared photos" on public.shared_photos
  for select to authenticated using (true);
create policy "Admins change shared photos" on public.shared_photos
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- The weekly photo cleanup must keep shared photos too (see docs/photo-cleanup.md).
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
    select m[1]
    from public.slides s,
      regexp_matches(s.data::text, 'https://images\.quizmatter\.com/uploads/[0-9a-f]{64}\.(?:webp|jpg)', 'g') as m
  ) as used (src);
$$;
