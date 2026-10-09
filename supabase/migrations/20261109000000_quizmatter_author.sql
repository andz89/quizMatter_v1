-- A QuizMatter presentation's (from_admin) Author is always "QuizMatter", however it's saved: the editor, Claude's
-- drafts, or "Move to QuizMatter". The app shows it as Author: QuizMatter and Publisher: QuizMatter. Keep
-- "QuizMatter" the same as QUIZMATTER_NAME in src/lib/schema.ts.

create function public.set_quizmatter_author()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.from_admin then
    new.author := 'QuizMatter';
  end if;
  return new;
end;
$$;

create trigger presentation_quizmatter_author
  before insert or update on public.presentations
  for each row execute function public.set_quizmatter_author();

-- The QuizMatter presentations made before this. Ones under review are locked (presentation_review_lock), so this
-- goes through the same way publish_review does. updated_at stays as it was.
select set_config('quizmatter.publishing_review', 'yes', true);
update public.presentations set author = 'QuizMatter' where from_admin and author <> 'QuizMatter';
select set_config('quizmatter.publishing_review', '', true);
