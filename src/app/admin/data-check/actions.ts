"use server";

import type { ZodError } from "zod";
import { getAccount } from "@/lib/account";
import { PRESENTATION_COLUMNS, rowToPresentationInput } from "@/lib/fetchPresentation";
import { presentationSchema } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";

export type DataProblem = {
  id: string;
  title: string;
  owner: string;
  // The slide's number (1 = first), or null when the problem isn't in a slide.
  slide: number | null;
  message: string;
  isReviewDraft: boolean;
  // A review draft only: its review page opens only while the round is submitted.
  isSubmitted: boolean;
};

// Presentations read per request, so the check never loads everything at once.
const PAGE_SIZE = 50;

/** The first problem zod found, as the slide's number and a message with where it is. */
function describe(error: ZodError): { slide: number | null; message: string } {
  const issue = error.issues[0];
  const [first, index] = issue.path;
  const slide = first === "slides" && typeof index === "number" ? index + 1 : null;
  return { slide, message: `${issue.message} (${issue.path.join(".") || "whole presentation"})` };
}

/**
 * The "Check saved data" button (Admin → Data check): reads every saved presentation and every review draft the way
 * the editor opens them (presentationSchema, which upgrades older shapes first) and lists the ones that fail. Works only
 * in development (`npm run dev`), run before a deploy that changes the saved shape. Only reads. Super admin only. A string = an
 * error message.
 */
export async function checkSavedData(): Promise<{ checked: number; problems: DataProblem[] } | string> {
  if (process.env.NODE_ENV !== "development") return "Run this on your computer (npm run dev).";
  if (!(await getAccount()).isSuperAdmin) return "Only the super admin can check saved data.";
  // The secret-key client: every teacher's presentations, which no account may read all of.
  const admin = createAdminClient();
  if (!admin) return "The secret key (SUPABASE_SECRET_KEY) isn't set.";
  const problems: (Omit<DataProblem, "owner"> & { ownerId: string })[] = [];
  let checked = 0;

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("presentations")
      .select(PRESENTATION_COLUMNS)
      .order("id")
      .order("position", { referencedTable: "slides" })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return "Couldn't read the presentations. Please try again.";
    for (const row of data) {
      const result = presentationSchema.safeParse(rowToPresentationInput(row));
      if (!result.success) {
        problems.push({ id: row.id, title: row.title, ownerId: row.owner_id, isReviewDraft: false, isSubmitted: false, ...describe(result.error) });
      }
    }
    checked += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  const { data: drafts, error } = await admin
    .from("presentation_reviews")
    .select("presentation_id, reviewer_id, status, draft")
    .not("draft", "is", null);
  if (error) return "Couldn't read the review drafts. Please try again.";
  for (const row of drafts) {
    const result = presentationSchema.safeParse(row.draft);
    if (!result.success) {
      problems.push({
        id: row.presentation_id,
        title: typeof row.draft?.title === "string" ? row.draft.title : "",
        ownerId: row.reviewer_id ?? "",
        isReviewDraft: true,
        isSubmitted: row.status === "submitted",
        ...describe(result.error),
      });
    }
  }
  checked += drafts.length;

  // Emails, once per person, only for the problems found.
  const emails = new Map<string, string>();
  for (const id of new Set(problems.map((problem) => problem.ownerId).filter(Boolean))) {
    const { data } = await admin.auth.admin.getUserById(id);
    emails.set(id, data.user?.email ?? "—");
  }
  return {
    checked,
    problems: problems.map(({ ownerId, ...problem }) => ({ ...problem, owner: emails.get(ownerId) ?? "—" })),
  };
}
