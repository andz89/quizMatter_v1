import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** A presentation sent to QuizMatter (see the quizmatter_submissions migration). */
export type SubmissionStatus = "submitted" | "sent_back" | "approved" | "canceled";

// The same words and colors on cards, tables and the view page.
export const SUBMISSION_LABELS: Record<SubmissionStatus, { label: string; className: string }> = {
  submitted: { label: "Waiting for QuizMatter", className: "bg-bg-page text-text-secondary" },
  sent_back: { label: "Sent back", className: "bg-highlight-soft text-highlight-strong" },
  approved: { label: "In QuizMatter", className: "bg-success-soft text-success-strong" },
  canceled: { label: "Canceled", className: "bg-danger-soft text-danger-strong" },
};

export type MySubmission = {
  // The receipt's own id: it stays after the original is deleted (see the submission_receipts migration).
  id: string;
  // My original; null once I deleted it (only an approved receipt stays then).
  presentationId: string | null;
  title: string;
  status: SubmissionStatus;
  adminNote: string;
  submittedAt: number;
  // The QuizMatter copy, once approved (null if it was deleted since).
  copyId: string | null;
};

type MySubmissionRow = {
  id: string;
  presentation_id: string | null;
  title: string;
  status: SubmissionStatus;
  admin_note: string | null;
  submitted_at: string;
  copy_id: string | null;
};

/** My submissions, newest first, with each one's current title. Throws if the lookup fails. */
export async function loadMySubmissions(supabase: SupabaseClient<Database>): Promise<MySubmission[]> {
  const { data, error } = await supabase.rpc("my_submissions");
  if (error) throw error;
  return (data as MySubmissionRow[]).map((row) => ({
    id: row.id,
    presentationId: row.presentation_id,
    title: row.title,
    status: row.status,
    adminNote: row.admin_note ?? "",
    submittedAt: Date.parse(row.submitted_at),
    copyId: row.copy_id,
  }));
}

/** One presentation's submission (its owner or an admin), or null. Throws if the lookup fails. */
export async function loadSubmissionStatus(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ status: SubmissionStatus; adminNote: string; submittedAt: number } | null> {
  const { data, error } = await supabase
    .rpc("submission_status", { target_id: id })
    .maybeSingle<{ status: SubmissionStatus; admin_note: string | null; submitted_at: string }>();
  if (error) throw error;
  if (!data) return null;
  return { status: data.status, adminNote: data.admin_note ?? "", submittedAt: Date.parse(data.submitted_at) };
}
