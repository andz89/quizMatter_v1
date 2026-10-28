-- Editors' profile photos (docs/superpowers/specs/2026-10-27-editor-profile-photo-design.md): an editor can put a
-- photo of themselves on their profile page. It shows at once (no admin checks it first), but an editor can save a
-- new one only 3 times a day (Philippine time), and any admin can remove it.
--
-- The photo isn't a column in user_settings: its "Own settings" policy lets a teacher write any column of their own
-- row straight through the API, which would skip the daily limit. It lives in its own table that nobody writes
-- directly; only the functions below change it. The file itself is stored in R2 like every photo, by the
-- /api/profile-photo route, which calls set_profile_photo before it stores the file (a refused upload takes no
-- storage). Test: supabase/tests/profile_photos.sql.

-- ─── 1. The table ─────────────────────────────────────────────────────────────────────────────────────────────
-- Tied to editors: taking the role away (or deleting the account, which removes the editors row) removes the photo.
-- Removing a photo only empties src, so the row keeps today's count and remove + add again can't reset it.
create table public.profile_photos (
  user_id uuid primary key references public.editors (user_id) on delete cascade,
  -- '' = no photo now.
  src text not null default '',
  -- The Philippine day of the last counted change, and how many photos were saved on it.
  day date,
  changes int not null default 0,
  updated_at timestamptz not null default now()
);

-- No policies: nobody reads or writes it directly. The account page reads it through my_profile_photo, profiles
-- through teacher_profile, and Admin → Editors with the secret key.
alter table public.profile_photos enable row level security;
revoke all on public.profile_photos from anon, authenticated;

-- ─── 2. Saving and removing ───────────────────────────────────────────────────────────────────────────────────
-- Saves the editor's new photo and counts it. Returns how many changes are left today. Refuses: not logged in or not
-- an editor (42501), banned (QMBAN), an address that isn't one of our own photo files (22023; same rule as
-- photoSchema and the delete-photo route), none left today (QMPPL).
create function public.set_profile_photo(src text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Asia/Manila')::date;
  photo public.profile_photos;
  used int;
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;
  if public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  if not public.is_editor() then
    raise exception 'Only editors can add a profile photo.' using errcode = '42501';
  end if;
  if coalesce(set_profile_photo.src, '') !~ '^https://images\.quizmatter\.com/uploads/[0-9a-f]{64}\.(webp|jpg)$' then
    raise exception 'Not one of our photo files.' using errcode = '22023';
  end if;

  -- The row is locked while it's counted, so two tabs saving at once can't both take the last change.
  insert into public.profile_photos (user_id) values (me) on conflict (user_id) do nothing;
  select * into photo from public.profile_photos p where p.user_id = me for update;
  used := case when photo.day = today then photo.changes else 0 end;
  -- Same limit as PROFILE_PHOTO_CHANGES_PER_DAY in src/lib/constants.ts.
  if used >= 3 then
    raise exception 'No profile photo changes left today.' using errcode = 'QMPPL';
  end if;

  update public.profile_photos p
  set src = set_profile_photo.src, day = today, changes = used + 1, updated_at = now()
  where p.user_id = me;
  return 3 - (used + 1);
end;
$$;

revoke execute on function public.set_profile_photo(text) from public, anon;
grant execute on function public.set_profile_photo(text) to authenticated;

-- The editor removes their own photo. It doesn't give a change back.
create function public.remove_profile_photo()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;
  update public.profile_photos p set src = '', updated_at = now() where p.user_id = auth.uid();
end;
$$;

revoke execute on function public.remove_profile_photo() from public, anon;
grant execute on function public.remove_profile_photo() to authenticated;

-- Any admin removes an editor's photo (Admin → Editors → the editor). Their count stays as it is. Logged in the Admin
-- log ("Removed a profile photo") with the editor's name, the same way admin_log_name builds one.
create function public.admin_remove_profile_photo(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  had_photo boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can remove a profile photo.' using errcode = '42501';
  end if;
  update public.profile_photos p set src = '', updated_at = now()
  where p.user_id = target and p.src <> ''
  returning true into had_photo;
  if had_photo then
    perform public.log_admin_action(
      'profile_photo_removed', 'user', target::text,
      (
        select coalesce(nullif(trim(s.display_name), ''), split_part(u.email, '@', 1), '')
        from auth.users u
        left join public.user_settings s on s.user_id = u.id
        where u.id = target
      ),
      null
    );
  end if;
end;
$$;

revoke execute on function public.admin_remove_profile_photo(uuid) from public, anon;
grant execute on function public.admin_remove_profile_photo(uuid) to authenticated;

-- ─── 3. Reading ───────────────────────────────────────────────────────────────────────────────────────────────
-- The account page: my photo ('' when none) and how many changes are left today. No row when I'm not an editor.
create function public.my_profile_photo()
returns table (src text, left_today int)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(p.src, ''),
    -- Same limit as PROFILE_PHOTO_CHANGES_PER_DAY in src/lib/constants.ts.
    3 - case when p.day = (now() at time zone 'Asia/Manila')::date then p.changes else 0 end
  from public.editors e
  left join public.profile_photos p on p.user_id = e.user_id
  where e.user_id = (select auth.uid());
$$;

revoke execute on function public.my_profile_photo() from public, anon;
grant execute on function public.my_profile_photo() to authenticated;

-- A profile page: same as 20261112000000_profile_name_links.sql, plus the photo ('' when none). Only editors have
-- one (the table is tied to editors).
drop function public.teacher_profile(text);
create function public.teacher_profile(slug text)
returns table (
  display_name text,
  first_name text,
  last_name text,
  education_level text,
  education_field text,
  bio text,
  photo_src text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.display_name,
    coalesce(s.first_name, ''),
    coalesce(s.last_name, ''),
    coalesce(s.education_level, ''),
    coalesce(s.education_field, ''),
    coalesce(s.bio, ''),
    coalesce(pp.src, '')
  from public.user_settings s
  left join public.profile_photos pp on pp.user_id = s.user_id
  where teacher_profile.slug <> ''
    and s.profile_slug = teacher_profile.slug
    and public.profile_is_visible(s.user_id);
$$;

revoke execute on function public.teacher_profile(text) from anon, public;
grant execute on function public.teacher_profile(text) to authenticated;

-- ─── 4. The weekly photo cleanup keeps profile photos ─────────────────────────────────────────────────────────
-- Same as 20261019000000_presentation_reviews.sql, plus every profile photo in use. A replaced or removed one is
-- deleted after its 7 days, like any unused photo.
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
    union
    select unnest(public.slide_photo_srcs(r.draft)) from public.presentation_reviews r where r.draft is not null
    union
    select pp.src from public.profile_photos pp where pp.src <> ''
  ) as used (src);
$$;

-- ─── 5. The Admin log's new action ────────────────────────────────────────────────────────────────────────────
-- Same list as 20261208000000_admin_log.sql, plus 'profile_photo_removed'. Same keys as ADMIN_ACTION_LABELS in
-- src/lib/adminActions.ts.
alter table public.admin_actions
  drop constraint admin_actions_action_check,
  add constraint admin_actions_action_check check (action in (
    'review_published', 'review_sent_back', 'review_canceled', 'review_opened', 'review_closed',
    'submission_approved', 'submission_sent_back',
    'presentation_shared', 'presentation_unshared', 'presentation_moved', 'presentation_hidden',
    'presentation_unhidden', 'reports_dismissed', 'presentation_deleted',
    'teacher_banned', 'ban_updated', 'teacher_unbanned', 'editor_added', 'editor_removed', 'pause_released',
    'category_created', 'category_renamed', 'category_deleted',
    'photo_deleted',
    'profile_photo_removed'
  ));
