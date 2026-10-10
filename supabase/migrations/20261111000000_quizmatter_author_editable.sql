-- A QuizMatter presentation's (from_admin) Author can now be changed: it starts as "QuizMatter" (the admin's New
-- button, or a Claude draft that names no author), but the admin can type another one, and Claude can fill in the
-- author the prompt or its documents name. The Publisher stays QuizMatter (that's from_admin, not this column).
-- Undoes the trigger from 20261109000000_quizmatter_author.sql; existing presentations keep their Author.

drop trigger if exists presentation_quizmatter_author on public.presentations;
drop function if exists public.set_quizmatter_author();
