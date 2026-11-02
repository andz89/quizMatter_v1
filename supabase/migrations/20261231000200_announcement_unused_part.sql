-- The part an announcement doesn't show is kept empty (test supabase/tests/announcement_unused_part.sql).
--
-- An announcement is a modal or a top bar (20261228000000_announcement_one_on.sql), but the form used to save what
-- was typed in the other one too. Nobody saw it (my_announcements sends only the open part), yet a photo in it
-- counted as used: the Photos tab named the announcement and refused to delete it, and the cleanup kept the file.
-- Now every write empties the part that isn't shown: a top bar has no modal text, attachment or html, a modal has no
-- bar html. (A row from before one-at-a-time that shows both keeps both.)

create function public.announcement_empty_unused_part()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.show_modal then
    new.modal_text := '';
    new.modal_attachment := null;
    new.modal_html := '';
  end if;
  if not new.show_bar then
    new.bar_html := '';
  end if;
  return new;
end;
$$;

revoke execute on function public.announcement_empty_unused_part() from public, anon, authenticated;

create trigger announcement_empty_unused_part
  before insert or update on public.announcements
  for each row execute function public.announcement_empty_unused_part();

-- Rows saved before this: the trigger empties their unused part (updated_at stays, so nothing shows again).
update public.announcements set show_modal = show_modal
where (not show_modal and (modal_text <> '' or modal_attachment is not null or modal_html <> ''))
  or (not show_bar and bar_html <> '');
