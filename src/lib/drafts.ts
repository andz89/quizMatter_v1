import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import type { QuizDetails } from "./importQuiz";

// Quiz drafts Claude sends through the MCP server (/api/mcp). They live in Cloudflare D1, not
// Supabase: a draft isn't anyone's quiz yet — it only becomes one when the user opens the link
// (it opens as a new quiz in the editor) and clicks Save. Server-only.

declare global {
  interface CloudflareEnv {
    DRAFTS_DB: D1Database;
  }
}

const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** What Claude sent: the quiz's details, and the slides as a recipe for buildSlides. */
export type Draft = { details: QuizDetails; slides: unknown[] };

/** Stores the draft and returns its id. Also clears out expired drafts. */
export async function saveDraft(draft: Draft): Promise<string> {
  const db = getCloudflareContext().env.DRAFTS_DB;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM drafts WHERE created_at < ?").bind(now - DRAFT_LIFETIME_MS),
    db.prepare("INSERT INTO drafts (id, recipe, created_at) VALUES (?, ?, ?)").bind(id, JSON.stringify(draft), now),
  ]);
  return id;
}

/** The draft saved under this id, or null if there's none (wrong id, or older than a day). */
export async function getDraft(id: string): Promise<Draft | null> {
  const row = await getCloudflareContext()
    .env.DRAFTS_DB.prepare("SELECT recipe FROM drafts WHERE id = ? AND created_at >= ?")
    .bind(id, Date.now() - DRAFT_LIFETIME_MS)
    .first<{ recipe: string }>();
  return row ? JSON.parse(row.recipe) : null;
}
