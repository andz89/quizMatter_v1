-- Author link fixes (after 20261216000000_author_link.sql, which is already applied).
-- 1. A display name change no longer counts as a presentation save. Its rewrite of linked Authors fired the
--    presentation write counter (a statement trigger, so even for a teacher with nothing linked): a teacher paused
--    for saving too fast couldn't change their name, and was told the name change was paused. A rename is already
--    counted by its own display_name limit.
-- 2. One-time link for presentations made before the link existed: lessons approved from an editor's submission,
--    and editors' own presentations (not shared copies). set_editor_author then writes the editor's name as Author.
--    Locked ones are fine: the review lock never compares author_id.

-- ─── 1. set_display_name: same as before (20261216000000_author_link.sql), the rename isn't a save ────────────
-- Keep 30 days the same as DISPLAY_NAME_CHANGE_DAYS in userSettings.ts.
create or replace function public.set_display_name(name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_name text := trim(coalesce(name, ''));
  current_name text;
  changed_at timestamptz;
  save_counted text;
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;

  perform public.count_click('display_name');

  select s.display_name, s.display_name_changed_at into current_name, changed_at
  from public.user_settings s
  where s.user_id = me;

  -- Nothing to change: no wait starts.
  if new_name = coalesce(current_name, '') then
    return jsonb_build_object('status', 'saved');
  end if;

  if not public.is_super_admin() and changed_at > now() - interval '30 days' then
    return jsonb_build_object(
      'status', 'wait',
      'until', (extract(epoch from changed_at + interval '30 days') * 1000)::bigint
    );
  end if;

  if new_name <> '' and not public.claim_display_name(public.profile_slug(new_name), me) then
    return jsonb_build_object('status', 'taken');
  end if;

  -- Lets the guard below through, for this transaction only.
  perform set_config('qm.set_display_name', 'on', true);
  begin
    insert into public.user_settings as s (user_id, display_name, display_name_changed_at, updated_at)
    values (me, new_name, now(), now())
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      display_name_changed_at = excluded.display_name_changed_at,
      updated_at = excluded.updated_at;
  exception when unique_violation then
    -- Someone took it at the same moment.
    return jsonb_build_object('status', 'taken');
  end;

  -- The new name goes on every presentation linked to me (my own and my QuizMatter lessons), even one under review
  -- (the lock lets this through). updated_at stays, so an open tab's next save doesn't conflict. It isn't a
  -- presentation save: the write counter's "already counted" flag is on for it, then back as it was.
  save_counted := coalesce(current_setting('quizmatter.write_counted', true), '');
  perform set_config('quizmatter.write_counted', 'yes', true);
  perform set_config('quizmatter.renaming_author', 'yes', true);
  update public.presentations p set author = public.editor_author(me) where p.author_id = me;
  perform set_config('quizmatter.renaming_author', '', true);
  perform set_config('quizmatter.write_counted', save_counted, true);

  return jsonb_build_object('status', 'saved');
end;
$$;

-- ─── 2. One-time link for what was made before ────────────────────────────────────────────────────────────────
-- Run as the migration's owner, so keep_author_id lets it through; no one is logged in, so nothing is counted.
update public.presentations p set author_id = s.submitter_id
from public.presentation_submissions s
where s.copy_id = p.id and s.status = 'approved' and s.submitter_id is not null and p.author_id is null;

update public.presentations p set author_id = p.owner_id
where not p.from_admin and p.shared_from is null and p.author_id is null
  and exists (select 1 from public.editors e where e.user_id = p.owner_id);
