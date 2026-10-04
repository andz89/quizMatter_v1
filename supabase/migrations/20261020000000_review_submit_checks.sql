-- Two fixes to submit_review (see 20261019000000_presentation_reviews.sql):
-- 1. Like save_review_draft, it refuses (QM409) a submit from a tab whose draft is older than the saved one, so an
--    old tab can't quietly replace newer work. `base_updated_at`: when the draft being submitted was saved (Unix ms),
--    or the live presentation's save time when there's no draft yet.
-- 2. Missing or empty "Reviewed by" details are refused too (a missing field made the old check pass).

drop function public.submit_review(text, jsonb, jsonb);

create function public.submit_review(target_id text, review_draft jsonb, fields jsonb, base_updated_at bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews := public.my_open_review(target_id);
begin
  if review.draft_updated_at is not null
    and (base_updated_at is null or floor(extract(epoch from review.draft_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This draft was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  perform public.check_review_draft(target_id, review_draft);
  -- Same limits as reviewerSchema in src/lib/schema.ts. The date may be "tomorrow" in UTC for teachers ahead of it.
  -- coalesce: a missing field makes the check null, which counts as not valid.
  if not coalesce(
    char_length(trim(fields ->> 'name')) between 1 and 100
      and char_length(fields ->> 'email') between 3 and 254
      and char_length(trim(fields ->> 'background')) between 1 and 1000
      and (fields ->> 'reviewedOn')::date <= current_date + 1,
    false
  ) then
    raise exception 'The reviewer details aren''t valid.' using errcode = '22023';
  end if;

  update public.presentation_reviews set
    draft = review_draft,
    draft_updated_at = now(),
    submitted_fields = jsonb_build_object(
      'name', trim(fields ->> 'name'),
      'email', fields ->> 'email',
      'background', trim(fields ->> 'background'),
      'reviewedOn', fields ->> 'reviewedOn'
    ),
    status = 'submitted',
    submitted_at = now(),
    admin_note = null
  where presentation_id = target_id;
end;
$$;

revoke execute on function public.submit_review(text, jsonb, jsonb, bigint) from public, anon;
grant execute on function public.submit_review(text, jsonb, jsonb, bigint) to authenticated;
