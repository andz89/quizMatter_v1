-- Likes: a teacher or an editor likes someone else's published presentation (QuizMatter's or another teacher's),
-- and everyone sees how many likes it has (on its card and its page). One like per person per presentation;
-- clicking again takes it back. Admins see the counts but can't like.
--
-- Who liked what stays private: people read only their own likes. The counts live in their own table, kept up to
-- date by a trigger, so a like never changes the presentations row (no updated_at change, no review lock, no
-- shared copy guard). A teacher's Publish updates its shared copy in place, so its likes stay.
--
-- Likes are changed only through set_liked(), which counts the click first (the one click limit system,
-- 20261013000000_click_limits.sql), like set_saved() (20261024000000_set_saved.sql).

-- ─── 1. Who liked what ────────────────────────────────────────────────────────────────────────────────────
create table public.presentation_likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  presentation_id text not null references public.presentations (id) on delete cascade,
  liked_at timestamptz not null default now(),
  primary key (user_id, presentation_id)
);

-- Deleting a presentation removes its likes.
create index presentation_likes_presentation_id_idx on public.presentation_likes (presentation_id);

alter table public.presentation_likes enable row level security;

-- People only see their own likes (to show the filled heart). Changes go through set_liked.
create policy "Read own likes" on public.presentation_likes
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.presentation_likes from anon, authenticated;

-- ─── 2. How many likes each presentation has ──────────────────────────────────────────────────────────────
create table public.presentation_like_counts (
  presentation_id text primary key references public.presentations (id) on delete cascade,
  total int not null default 0 check (total >= 0)
);

alter table public.presentation_like_counts enable row level security;

-- Anyone who can read the presentation can read its count (the presentations policies decide).
create policy "Read like counts" on public.presentation_like_counts
  for select to authenticated
  using (exists (select 1 from public.presentations p where p.id = presentation_id));

revoke insert, update, delete on public.presentation_like_counts from anon, authenticated;

-- Keeps the count right on every like and unlike, also when a like goes because its account was deleted.
create function public.count_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.presentation_like_counts as c (presentation_id, total) values (new.presentation_id, 1)
    on conflict (presentation_id) do update set total = c.total + 1;
    return new;
  end if;
  -- The presentation itself may be going (its count row goes with it): then this updates nothing.
  update public.presentation_like_counts c set total = greatest(c.total - 1, 0) where c.presentation_id = old.presentation_id;
  return old;
end;
$$;

create trigger count_like
  after insert or delete on public.presentation_likes
  for each row execute function public.count_like();

-- ─── 3. The click limit ───────────────────────────────────────────────────────────────────────────────────
-- Same as bookmarks: 20 clicks in 25 seconds pauses for 10 minutes (1 hour if again within 24 hours), and 3
-- pauses in a row ban. Same feature name as CLICK_FEATURES in src/lib/clickLimits.ts.
insert into public.click_limits
  (feature, label, max_clicks, per_seconds, first_pause_minutes, repeat_pause_minutes, repeat_within_hours, ban_after_pauses)
values
  ('like', 'Like', 20, 25, 10, 60, 24, 3);

-- ─── 4. set_liked: like (is_liked true) or take a like back ───────────────────────────────────────────────
-- Answers 'done', 'banned' or 'failed' (not a presentation I may like, or I'm an admin). A paused teacher gets
-- count_click's error (QMBLK). Already liked / already taken back is 'done'.
create function public.set_liked(presentation_id text, is_liked boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  -- Only teachers and editors like; admins only see the counts.
  if me is null or public.is_admin() then
    return 'failed';
  end if;
  if public.is_banned() then
    return 'banned';
  end if;
  perform public.count_click('like');
  -- This click may have just banned them (see count_click): nothing changes, and they're told at once.
  if public.is_banned() then
    return 'banned';
  end if;

  if not is_liked then
    delete from public.presentation_likes l where l.user_id = me and l.presentation_id = set_liked.presentation_id;
    return 'done';
  end if;

  -- Only someone else's presentation that they can see (published and not hidden).
  if not exists (
    select 1 from public.presentations p
    where p.id = set_liked.presentation_id and p.is_published and p.hidden_at is null and p.owner_id <> me
  ) then
    return 'failed';
  end if;

  insert into public.presentation_likes (user_id, presentation_id) values (me, set_liked.presentation_id)
  on conflict do nothing;
  return 'done';
end;
$$;

revoke execute on function public.set_liked(text, boolean) from public, anon;
grant execute on function public.set_liked(text, boolean) to authenticated;
