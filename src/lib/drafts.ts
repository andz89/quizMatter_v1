import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

// Quiz drafts Claude sends through the MCP server (/api/mcp). They live in Cloudflare D1, not
// Supabase: a draft isn't anyone's quiz yet — it only becomes one when the user opens the link
// in the editor and clicks Save. Server-only.

declare global {
  interface CloudflareEnv {
    DRAFTS_DB: D1Database;
  }
}

const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Stores the recipe (the JSON Claude wrote) and returns its id. Also clears out expired drafts. */
export async function saveDraft(recipe: unknown): Promise<string> {
  const db = getCloudflareContext().env.DRAFTS_DB;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM drafts WHERE created_at < ?").bind(now - DRAFT_LIFETIME_MS),
    db.prepare("INSERT INTO drafts (id, recipe, created_at) VALUES (?, ?, ?)").bind(id, JSON.stringify(recipe), now),
  ]);
  return id;
}

/** The recipe saved under this id, or null if there's none (wrong id, or older than a day). */
export async function getDraft(id: string): Promise<unknown> {
  const row = await getCloudflareContext()
    .env.DRAFTS_DB.prepare("SELECT recipe FROM drafts WHERE id = ? AND created_at >= ?")
    .bind(id, Date.now() - DRAFT_LIFETIME_MS)
    .first<{ recipe: string }>();
  return row ? JSON.parse(row.recipe) : null;
}
