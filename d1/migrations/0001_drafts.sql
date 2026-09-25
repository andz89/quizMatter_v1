-- Quiz drafts Claude sends through the MCP server. Each one is opened from a link and then
-- removed after a day (see src/lib/drafts.ts).
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  recipe TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
