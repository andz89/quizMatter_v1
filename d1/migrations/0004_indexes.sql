-- Lookups without reading the whole table (see src/lib/drafts.ts and src/lib/photoTickets.ts): a user's drafts
-- (listDrafts, getDraft, replaceDraft: by owner_id, newest first) and the expiry deletes (by created_at).
CREATE INDEX IF NOT EXISTS drafts_owner_created ON drafts (owner_id, created_at);
CREATE INDEX IF NOT EXISTS drafts_created ON drafts (created_at);
CREATE INDEX IF NOT EXISTS photo_tickets_created ON photo_tickets (created_at);
