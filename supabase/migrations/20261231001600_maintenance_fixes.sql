-- Maintenance fixes from the 2026-11-13 review (spec docs/superpowers/specs/2026-11-15-maintenance-review-fixes-design.md,
-- test supabase/tests/maintenance_fixes.sql). Newest set_maintenance:
-- 1. turn_on null is refused. On while already on changes nothing and logs nothing (two tabs or a double click used
--    to write a new start time and note, and log a second maintenance_on). Off while off logs nothing, but still
--    clears our guard setting, so "off" is always the way out.
-- 2. The authenticator role's pgrst.db_pre_request holds one function. If it names another one (someone else's
--    hook), turning on is refused and turning off leaves it alone, instead of overwriting or wiping it.

create or replace function public.set_maintenance(turn_on boolean, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_on boolean;
  hook text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if turn_on is null then
    raise exception 'Say whether to turn maintenance on or off.' using errcode = '22023';
  end if;

  -- The pre-request function PostgREST runs now (null = none), set by "alter role authenticator set …".
  select substr(c, length('pgrst.db_pre_request=') + 1) into hook
  from pg_catalog.pg_db_role_setting s join pg_catalog.pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
  where r.rolname = 'authenticator' and s.setdatabase = 0 and c like 'pgrst.db_pre_request=%';
  if hook = 'public.check_maintenance' then
    hook := null;
  end if;

  select m.is_on into was_on from public.maintenance m where m.id for update;

  if turn_on then
    if hook is not null then
      raise exception 'Another pre-request hook (%) is set, so the maintenance guard can''t be added. Put its check inside check_maintenance first.', hook
        using errcode = '22023';
    end if;
    alter role authenticator set pgrst.db_pre_request = 'public.check_maintenance';
    if not was_on then
      update public.maintenance
      set is_on = true, message = btrim(coalesce(note, '')), started_at = now(), started_by = auth.uid(), planned_at = null
      where id;
    end if;
  else
    if hook is null then
      alter role authenticator reset pgrst.db_pre_request;
    end if;
    if was_on then
      update public.maintenance set is_on = false, started_at = null, started_by = null where id;
    end if;
  end if;
  notify pgrst, 'reload config';

  if turn_on is distinct from was_on then
    perform public.log_admin_action(
      case when turn_on then 'maintenance_on' else 'maintenance_off' end, 'site', null, 'QuizMatter', null
    );
  end if;
end;
$$;
