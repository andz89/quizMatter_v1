import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { ClaudePhotoDetails } from "./schema";

// One-time upload links for photos Claude adds to the shared photo library. Claude can't hand a photo's file to
// the MCP server, so prepare_photo_upload (/api/mcp) saves each photo's details here as a "ticket" and gives Claude
// a link with its id. Claude then sends the file from its code sandbox to /api/claude-photo?ticket=<id>, which
// saves the photo with these details and removes the ticket. They live in D1 next to the drafts. Server-only.

export const PHOTO_TICKET_LIFETIME_MS = 60 * 60 * 1000;

export type PhotoTicket = { ownerId: string; details: ClaudePhotoDetails };

/** Stores a ticket for each photo and returns their ids, in the same order. Also clears out expired tickets. */
export async function createPhotoTickets(ownerId: string, photos: ClaudePhotoDetails[]): Promise<string[]> {
  const db = getCloudflareContext().env.DRAFTS_DB;
  const now = Date.now();
  const ids = photos.map(() => crypto.randomUUID());
  await db.batch([
    db.prepare("DELETE FROM photo_tickets WHERE created_at < ?").bind(now - PHOTO_TICKET_LIFETIME_MS),
    ...photos.map((photo, i) =>
      db
        .prepare("INSERT INTO photo_tickets (id, owner_id, details, created_at) VALUES (?, ?, ?, ?)")
        .bind(ids[i], ownerId, JSON.stringify(photo), now),
    ),
  ]);
  return ids;
}

/** The ticket with this id, or null if there's none (wrong id, already used, or expired). */
export async function getPhotoTicket(id: string): Promise<PhotoTicket | null> {
  const row = await getCloudflareContext()
    .env.DRAFTS_DB.prepare("SELECT owner_id, details FROM photo_tickets WHERE id = ? AND created_at >= ?")
    .bind(id, Date.now() - PHOTO_TICKET_LIFETIME_MS)
    .first<{ owner_id: string; details: string }>();
  return row ? { ownerId: row.owner_id, details: JSON.parse(row.details) } : null;
}

/**
 * Removes a used ticket, so its link can't add the photo again. True if this call removed it; false if it was
 * already gone (e.g. the same link sent twice at once, and the other one got it first).
 */
export async function deletePhotoTicket(id: string): Promise<boolean> {
  const result = await getCloudflareContext().env.DRAFTS_DB.prepare("DELETE FROM photo_tickets WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}
