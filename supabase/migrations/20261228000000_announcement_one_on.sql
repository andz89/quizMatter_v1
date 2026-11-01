-- One modal and one top bar on at a time (spec docs/superpowers/specs/2026-11-01-announcement-one-on-design.md).
--
-- An announcement is one type now: a modal or a top bar, never both. At most one of each is on (switched on and
-- not ended; a scheduled one counts). Turning on a second one is refused with QMONE (the message is the name of
-- the one that is on), so the app can ask; sent again with replace_current, the old one is turned off in the
-- same step. This replaces the old "at most 20 on" limit (check_announcement_limit).
--
-- save_announcement and set_announcement_on get a new argument with a default. The old versions are dropped
-- first: next to them, a call without the new argument would match both and be refused as ambiguous.

drop function public.save_announcement(jsonb);
drop function public.set_announcement_on(uuid, boolean);
drop function public.check_announcement_limit();

-- Called right after a write that leaves `saved` on. Returns the name of the one it turned off, or null.
create function public.check_one_on(saved uuid, replace_current boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  is_modal boolean;
  other_id uuid;
  other_name text;
begin
  -- One at a time, so two tabs can't both turn one on (the lock waits for the other step to finish, then this
  -- step's next query sees what it saved).
  perform pg_advisory_xact_lock(hashtext('public.announcements'));

  select a.show_modal into is_modal from public.announcements a where a.id = saved;
  select a.id, a.name into other_id, other_name
  from public.announcements a
  where a.id <> saved and a.is_on and (a.ends_at is null or a.ends_at > now())
    and (case when is_modal then a.show_modal else a.show_bar end)
  limit 1;

  if other_id is null then
    return null;
  end if;
  if not replace_current then
    raise exception '%', other_name using errcode = 'QMONE';
  end if;
  update public.announcements set is_on = false, updated_at = clock_timestamp() where id = other_id;
  return other_name;
end;
$$;

revoke execute on function public.check_one_on(uuid, boolean) from public, anon, authenticated;

create function public.save_announcement(a jsonb, replace_current boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.announcements := jsonb_populate_record(null::public.announcements, a);
  saved_id uuid;
  turned_off text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  -- Same rule as announcementSchema (src/lib/announcements.ts).
  if r.show_modal and r.show_bar then
    raise exception 'Pick a modal or a top bar, not both.' using errcode = '22023';
  end if;

  if r.id is null then
    insert into public.announcements (
      name, is_on, starts_at, ends_at, show_modal, modal_text, modal_attachment, modal_close_after, show_bar, bar_html,
      bar_close_after, repeat, pages, genders, age_min, age_max, education_levels,
      field_words, presentations_min, presentations_max, roles, modal_size, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, coalesce(r.modal_text, ''), r.modal_attachment, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'), auth.uid(), now(),
      clock_timestamp()
    )
    returning id into saved_id;
  else
    update public.announcements x set
      name = btrim(r.name), is_on = r.is_on, starts_at = r.starts_at, ends_at = r.ends_at,
      show_modal = r.show_modal, modal_text = coalesce(r.modal_text, ''), modal_attachment = r.modal_attachment, modal_close_after = r.modal_close_after,
      show_bar = r.show_bar, bar_html = r.bar_html, bar_close_after = r.bar_close_after, repeat = r.repeat,
      pages = r.pages, genders = r.genders, age_min = r.age_min, age_max = r.age_max,
      education_levels = r.education_levels, field_words = r.field_words,
      presentations_min = r.presentations_min, presentations_max = r.presentations_max, roles = r.roles,
      modal_size = coalesce(r.modal_size, 'large'), updated_at = clock_timestamp(),
      -- Ending later again after its cleanup: its closed rows start over (they were deleted).
      closed_cleared_at = case when r.ends_at is null or r.ends_at > now() then null else x.closed_cleared_at end
    where x.id = r.id
    returning x.id into saved_id;
    if saved_id is null then
      raise exception 'This announcement was deleted.' using errcode = 'P0002';
    end if;
  end if;

  if r.is_on and (r.ends_at is null or r.ends_at > now()) then
    turned_off := public.check_one_on(saved_id, replace_current);
  end if;
  perform public.log_admin_action('announcement_saved', 'announcement', saved_id::text, btrim(r.name),
    case when turned_off is null then null else jsonb_build_object('turned_off', turned_off) end);
  return saved_id;
end;
$$;

revoke execute on function public.save_announcement(jsonb, boolean) from public, anon;
grant execute on function public.save_announcement(jsonb, boolean) to authenticated;

create function public.set_announcement_on(target uuid, turn_on boolean, replace_current boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_name text;
  saved_ends timestamptz;
  turned_off text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  update public.announcements set is_on = turn_on, updated_at = clock_timestamp()
  where id = target
  returning name, ends_at into saved_name, saved_ends;
  if saved_name is null then
    raise exception 'This announcement was deleted.' using errcode = 'P0002';
  end if;

  if turn_on and (saved_ends is null or saved_ends > now()) then
    turned_off := public.check_one_on(target, replace_current);
  end if;
  perform public.log_admin_action(
    'announcement_saved', 'announcement', target::text, saved_name,
    jsonb_strip_nulls(jsonb_build_object('is_on', turn_on, 'turned_off', turned_off))
  );
end;
$$;

revoke execute on function public.set_announcement_on(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_announcement_on(uuid, boolean, boolean) to authenticated;
