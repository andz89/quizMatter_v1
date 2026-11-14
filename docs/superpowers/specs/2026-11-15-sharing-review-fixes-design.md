# Sharing review fixes (2026-11-15)

Fixes from the `/code-review high` of sharing (2026-11-13): findings 1, 2, 3, 6, 7, 8 and 10. Findings 4, 5 and 9
(maintenance) are a separate change.

## Why

An admin's hide of a teacher's shared copy must stick (spec `2026-10-11-shared-copy-design`), and "Publish" must
not let an empty-looking presentation through. Today a teacher can undo a hide in one or two clicks.

## What changes

1. **Can't delete an original whose shared copy is hidden** (finding 1). `check_hidden_copy_delete` refuses it for a
   teacher (new code `QMHID`), the same rule that already stops "make private". Admins still delete it (Admin →
   Reports), and account deletion still works (it runs without a logged-in user). Before: deleting the original took
   the hidden copy and its reports with it, and a copy made earlier could then be published.
2. **Can't update a hidden shared copy** (finding 2). `share_presentation` refuses when the copy is hidden, so
   "Update shared presentation" can't overwrite the reported content.
3. **The whole "copied from" chain is checked** (found while fixing 1). Publishing a copy of a copy of a hidden
   presentation (A → B → C) was allowed: the check looked one step back only. It now follows `copied_from` all the
   way up (at most 100 steps). Left on purpose: a teacher who copies, deletes the middle copy, then publishes the
   last one, or who retypes the content. Admins handle that with reports and bans; no check can stop retyping.
4. **"Has content" skips hidden slides and empty text boxes** (finding 6), in both `has_publishable_content` and the
   app's `hasSlideContent` (same rule): a hidden slide never counts, and a text box counts only if its text (without
   tags) isn't blank. Other elements (shapes, pictures, tables, diagrams) still count.
5. **Copy columns are tested** (finding 8): a SQL test fails when a `presentations` column isn't copied by
   `share_presentation` and isn't on its list of columns that differ on purpose.
6. **Finding 7: kept as is, on purpose.** `check_shared_copy_change` refuses any change but `hidden_at`. Listing
   only the columns a copy may never change would fail open: a new column left off the list could be changed by the
   owner directly. Failing closed is right for this check; the new test checks that an admin can still hide and show
   a copy, so a trigger that breaks it is caught.
7. **Plain words for Postgres's own refusals** (finding 10). `refused()` in `src/lib/sharing.ts` shows a 42501
   message only when it's one of ours; Postgres's own texts ("permission denied …", "… row-level security …")
   become "You can't change the sharing of this presentation."
8. **Warning on the old migration** (finding 3): a comment at the top of `20261123000000_shared_copy.sql` says
   never to paste it again (it deletes every shared copy). Its SQL doesn't change.

The home page's delete buttons show the `QMHID` message instead of "Please try again"
(`removePresentations` returns the reason).

## Approaches considered for 1 + 3

- **Refuse the delete + follow the chain** (picked): small, no new column, matches the existing "can't make private".
- A saved list of every source a copy came from (a new column): closes the "delete the middle copy" path too, but adds
  a column, a backfill and more code for a path that is no harder than retyping.
- Keep the hidden copy when its original is deleted: breaks the rule that a copy always has an original.
