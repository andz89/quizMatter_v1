-- Teachers read the "Reviewed by" list (presentation_reviewers) but not who approved each review: approved_by and
-- approved_at are for admins only, who read them through admin_reviewers() (see 20261021000000_review_approvals.sql).
-- So teachers get only the public columns. The row rule ("Read reviewers of readable presentations") stays as is.

revoke select on public.presentation_reviewers from anon, authenticated;
grant select (presentation_id, reviewer_id, name, email, background, reviewed_on)
  on public.presentation_reviewers to authenticated;
