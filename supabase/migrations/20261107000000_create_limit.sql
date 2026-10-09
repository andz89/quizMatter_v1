-- New presentations click limit: each teacher can make 20 new presentations a day, counted again from 12:00
-- midnight Philippine time (like publishing, 20261105000000_publish_daily_reset.sql). Reaching it pauses making new
-- ones until that midnight. No ban.
--
-- Every new presentation counts, however it's made: "+ New presentation", "Make a copy", or saving a draft from
-- Claude. They all save through save_presentation, so the database can't tell a copy from a new one, and counting
-- only copies could be skipped (make a new one and save the copied slides into it). This stops the "copy 50, delete,
-- copy 50 again" loop and scripts filling the database. Admins and QuizMatter presentations (from_admin) aren't
-- counted. Uses the one click limit system (20261013000000_click_limits.sql).

insert into public.click_limits
  (feature, label, max_clicks, per_seconds, first_pause_minutes, repeat_pause_minutes, repeat_within_hours, ban_after_pauses, daily_reset_time_zone)
values
  ('create', 'New presentations', 20, 86400, 1440, 1440, 24, null, 'Asia/Manila');

create function public.count_new_presentation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- save_presentation's "insert … on conflict do update" runs this for existing presentations too: those are only
  -- being saved again, not made.
  if new.from_admin or exists (select 1 from public.presentations p where p.id = new.id) then
    return new;
  end if;
  perform public.count_click('create');
  return new;
end;
$$;

create trigger count_new_presentation
  before insert on public.presentations
  for each row execute function public.count_new_presentation();
