-- Trigger functions only run from their triggers. Postgres lets everyone call a new function by default, so
-- anon and signed-in users could call these through the API. Take that away (triggers still run).
revoke execute on function public.cancel_reviews_of_removed_editor() from public, anon, authenticated;
revoke execute on function public.check_ban_target() from public, anon, authenticated;
revoke execute on function public.count_like() from public, anon, authenticated;
revoke execute on function public.drop_unapproved_submission() from public, anon, authenticated;
revoke execute on function public.drop_waiting_editor_photo() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.publish_photos_of_live_presentation() from public, anon, authenticated;
revoke execute on function public.publish_photos_of_new_slide() from public, anon, authenticated;
revoke execute on function public.refuse_locked_photo_delete() from public, anon, authenticated;
revoke execute on function public.set_editor_author() from public, anon, authenticated;
revoke execute on function public.share_editor_photo() from public, anon, authenticated;
revoke execute on function public.share_new_editor_photos() from public, anon, authenticated;
revoke execute on function public.sync_slide_photos() from public, anon, authenticated;
revoke execute on function public.remove_copy_of_quizmatter_presentation() from public, anon, authenticated;
revoke execute on function public.remove_new_editor_copies() from public, anon, authenticated;
