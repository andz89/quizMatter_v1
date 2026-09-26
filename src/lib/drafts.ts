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

export const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;
// A draft Claude is still checking shows as "Checking…" (not openable) until the final version replaces
// it. After this long without one, Claude has likely stopped, so it shows as "Not finished" and opens.
export const CHECK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * What Claude sent: the quiz's details, and the slides as a recipe for buildSlides. `checking` = a first
 * version Claude sent to see the layout report, before its final one.
 */
export type Draft = { details: QuizDetails; slides: unknown[]; checking?: boolean };

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

/**
 * Replaces the draft saved under this id (Claude sending a fixed version), so its link stays the same.
 * Its day starts over. False if there's no such draft (wrong id, or older than a day).
 */
export async function replaceDraft(id: string, draft: Draft): Promise<boolean> {
  const now = Date.now();
  const result = await getCloudflareContext()
    .env.DRAFTS_DB.prepare("UPDATE drafts SET recipe = ?, created_at = ? WHERE id = ? AND created_at >= ?")
    .bind(JSON.stringify(draft), now, id, now - DRAFT_LIFETIME_MS)
    .run();
  return result.meta.changes > 0;
}

/** The draft saved under this id, or null if there's none (wrong id, or older than a day). */
export async function getDraft(id: string): Promise<Draft | null> {
  const row = await getCloudflareContext()
    .env.DRAFTS_DB.prepare("SELECT recipe FROM drafts WHERE id = ? AND created_at >= ?")
    .bind(id, Date.now() - DRAFT_LIFETIME_MS)
    .first<{ recipe: string }>();
  return row ? JSON.parse(row.recipe) : null;
}

/**
 * What the quiz list shows of a draft. `state`: "ready" = Claude's final version; "checking" = Claude is
 * still checking it (not openable yet); "unfinished" = checked, but no final version came within CHECK_TIMEOUT_MS.
 */
export type DraftSummary = {
  id: string;
  title: string;
  grade: string;
  subject: string;
  slideCount: number;
  createdAt: number;
  state: "ready" | "checking" | "unfinished";
};

/** Every draft that hasn't expired, newest first. */
export async function listDrafts(): Promise<DraftSummary[]> {
  const now = Date.now();
  const { results } = await getCloudflareContext()
    .env.DRAFTS_DB.prepare(
      `SELECT id, json_extract(recipe, '$.details.title') AS title, json_extract(recipe, '$.details.grade') AS grade,
         json_extract(recipe, '$.details.subject') AS subject, json_array_length(recipe, '$.slides') AS slideCount,
         created_at AS createdAt, json_extract(recipe, '$.checking') AS checking
       FROM drafts WHERE created_at >= ? ORDER BY created_at DESC`,
    )
    .bind(now - DRAFT_LIFETIME_MS)
    .all<Omit<DraftSummary, "state"> & { checking: number | null }>();
  return results.map(({ checking, ...draft }) => ({
    ...draft,
    state: !checking ? "ready" : now - draft.createdAt < CHECK_TIMEOUT_MS ? "checking" : "unfinished",
  }));
}

/** Deletes these drafts in one trip to the database. */
export async function deleteDrafts(ids: string[]) {
  if (ids.length === 0) return;
  const db = getCloudflareContext().env.DRAFTS_DB;
  await db.batch(ids.map((id) => db.prepare("DELETE FROM drafts WHERE id = ?").bind(id)));
}
