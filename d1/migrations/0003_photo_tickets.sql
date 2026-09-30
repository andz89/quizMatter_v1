-- One-time upload links for photos Claude adds to the shared photo library (see src/lib/photoTickets.ts).
-- Each one holds the photo's details (name, description, tags, category, source) until its file arrives.
CREATE TABLE photo_tickets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
