import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import type { ClaudeDetails } from "./importPresentation";
import { withGrades } from "./schema";

// Presentation drafts Claude sends through the MCP server (/api/mcp). They live in Cloudflare D1, not
// Supabase: a draft isn't anyone's presentation yet — it only becomes one when the user opens the link
// (it opens as a new presentation in the editor) and clicks Save. Server-only.
// Each draft belongs to the user who connected Claude (`ownerId`, their Supabase user id), and only they
// can see, open or delete it.

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
 * What Claude sent: the presentation's details, and the slides as a recipe for buildSlides. `checking` = a first
 * version Claude sent to see the layout report, before its final one.
 */
export type Draft = { details: ClaudeDetails; slides: unknown[]; checking?: boolean };

/** Stores the draft and returns its id. Also clears out expired drafts. */
export async function saveDraft(draft: Draft, ownerId: string): Promise<string> {
  const db = getCloudflareContext().env.DRAFTS_DB;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM drafts WHERE created_at < ?").bind(now - DRAFT_LIFETIME_MS),
    db
      .prepare("INSERT INTO drafts (id, owner_id, recipe, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, ownerId, JSON.stringify(draft), now),
  ]);
  return id;
}

/**
 * Replaces the draft saved under this id (Claude sending a fixed version), so its link stays the same.
 * Its day starts over. False if there's no such draft of this owner (wrong id, or older than a day).
 */
export async function replaceDraft(id: string, draft: Draft, ownerId: string): Promise<boolean> {
  const now = Date.now();
  const result = await getCloudflareContext()
    .env.DRAFTS_DB.prepare("UPDATE drafts SET recipe = ?, created_at = ? WHERE id = ? AND owner_id = ? AND created_at >= ?")
    .bind(JSON.stringify(draft), now, id, ownerId, now - DRAFT_LIFETIME_MS)
    .run();
  return result.meta.changes > 0;
}

/** The owner's draft saved under this id, or null if there's none (wrong id, someone else's, or older than a day). */
export async function getDraft(id: string, ownerId: string): Promise<Draft | null> {
  const row = await getCloudflareContext()
    .env.DRAFTS_DB.prepare("SELECT recipe FROM drafts WHERE id = ? AND owner_id = ? AND created_at >= ?")
    .bind(id, ownerId, Date.now() - DRAFT_LIFETIME_MS)
    .first<{ recipe: string }>();
  if (!row) return null;
  const draft: Draft = JSON.parse(row.recipe);
  return { ...draft, details: withGrades(draft.details) };
}

/**
 * What the presentation list shows of a draft. `state`: "ready" = Claude's final version; "checking" = Claude is
 * still checking it (not openable yet); "unfinished" = checked, but no final version came within CHECK_TIMEOUT_MS.
 */
export type DraftSummary = {
  id: string;
  title: string;
  grades: string[];
  subject: string;
  // The tags as one line of text ("fractions addition"), only for search.
  tags: string;
  slideCount: number;
  createdAt: number;
  state: "ready" | "checking" | "unfinished";
};

/** Every draft of this owner that hasn't expired, newest first. */
export async function listDrafts(ownerId: string): Promise<DraftSummary[]> {
  const now = Date.now();
  const { results } = await getCloudflareContext()
    .env.DRAFTS_DB.prepare(
      `SELECT id, json_extract(recipe, '$.details.title') AS title, json_extract(recipe, '$.details.grades') AS grades, json_extract(recipe, '$.details.grade') AS grade,
         json_extract(recipe, '$.details.subject') AS subject,
         coalesce((SELECT group_concat(value, ' ') FROM json_each(recipe, '$.details.tags')), '') AS tags, json_array_length(recipe, '$.slides') AS slideCount,
         created_at AS createdAt, json_extract(recipe, '$.checking') AS checking
       FROM drafts WHERE owner_id = ? AND created_at >= ? ORDER BY created_at DESC`,
    )
    .bind(ownerId, now - DRAFT_LIFETIME_MS)
    .all<Omit<DraftSummary, "state" | "grades"> & { grades: string | null; grade: string | null; checking: number | null }>();
  return results.map(({ checking, grades, grade, ...draft }) => ({
    ...draft,
    // A draft from before several grades has one `grade`.
    grades: grades ? (JSON.parse(grades) as string[]) : grade ? [grade] : [],
    state: !checking ? "ready" : now - draft.createdAt < CHECK_TIMEOUT_MS ? "checking" : "unfinished",
  }));
}

/** Deletes these drafts of this owner in one trip to the database. */
export async function deleteDrafts(ids: string[], ownerId: string) {
  if (ids.length === 0) return;
  const db = getCloudflareContext().env.DRAFTS_DB;
  await db.batch(ids.map((id) => db.prepare("DELETE FROM drafts WHERE id = ? AND owner_id = ?").bind(id, ownerId)));
}
