-- The click history (Admin → Safety → History, 20261017000000_click_history.sql) keeps a deleted account's pauses,
-- bans and releases, so the record of who reached a limit stays. Each row saves the account's email when it's
-- written; deleting the account only empties user_id. The admin page shows the saved email for those rows.

alter table public.click_history add column email text;

-- The rows already there get their email now.
update public.click_history h
set email = u.email
from auth.users u
where u.id = h.user_id;

alter table public.click_history alter column user_id drop not null;
alter table public.click_history drop constraint click_history_user_id_fkey;
alter table public.click_history
  add constraint click_history_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

-- Every new row saves the account's email: count_click's pauses and bans, and the admin's Release
-- (src/app/admin/safety/actions.ts), so neither has to send it. Security definer: it reads auth.users.
create function public.set_click_history_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := (select u.email from auth.users u where u.id = new.user_id);
  return new;
end;
$$;

revoke execute on function public.set_click_history_email() from public, anon, authenticated;

create trigger set_click_history_email
  before insert on public.click_history
  for each row execute function public.set_click_history_email();
