-- Each draft belongs to the user who connected Claude (their Supabase user id), and only they see it.
-- Drafts from before this have no owner (''), so nobody sees them; they expire within a day anyway.
ALTER TABLE drafts ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
