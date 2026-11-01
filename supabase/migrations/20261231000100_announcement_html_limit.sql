-- The sealed box's HTML (an html modal or top bar) may be up to 100,000 characters, up from 50,000. At most one modal
-- and one bar are on, so a teacher downloads 200 KB at worst (much less compressed), once per visit. A text bar stays
-- at 1,000. Same limit as ANNOUNCEMENT_LIMITS.modalHtml (src/lib/announcements.ts).

alter table public.announcements drop constraint announcements_modal_html_check;
alter table public.announcements add constraint announcements_modal_html_check
  check (char_length(modal_html) <= 100000);

alter table public.announcements drop constraint announcements_bar_html_check;
alter table public.announcements add constraint announcements_bar_html_check
  check (char_length(bar_html) <= case when bar_format = 'html' then 100000 else 1000 end);
