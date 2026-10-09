-- Fix for the share and publish click limits (20261103000000_share_limits.sql): saving an already published
-- presentation counted as a switch and a publish.
--
-- save_presentation saves with "insert … on conflict do update". For that, PostgreSQL runs the BEFORE INSERT
-- triggers for every row, even one that already exists (then the BEFORE UPDATE ones for the update). So
-- count_share_clicks saw each save of a published presentation as a new published one, and counted it. 10 saves
-- paused publishing, and while sharing was paused, saving a published presentation was refused.
--
-- Now, like check_presentation_limit, the insert part skips a presentation that already exists: only the update part
-- counts it, and only when is_published really changes.
--
-- Everyone's share and publish counts start again, so nobody stays paused by the wrong counts.

create or replace function public.count_share_clicks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.from_admin
    or (tg_op = 'INSERT' and (not new.is_published or exists (select 1 from public.presentations p where p.id = new.id)))
    or (tg_op = 'UPDATE' and new.is_published = old.is_published) then
    return new;
  end if;
  perform public.count_click('share');
  if new.is_published then
    perform public.count_click('publish');
    -- save_presentation checks the content itself, after it saves the slides. A plain update of the row (not
    -- through it) changes no slides, so the saved ones are checked here.
    if coalesce(current_setting('quizmatter.saving_presentation', true), '') <> 'yes'
      and not public.is_admin()
      and not public.has_publishable_content(new.id) then
      raise exception 'Add a title and some content before publishing.' using errcode = 'QMPUB';
    end if;
  end if;
  return new;
end;
$$;

delete from public.click_rate where feature in ('share', 'publish');
