import { joinParts, timeAgo } from "@/lib/format";
import { loadPublisherNames } from "@/lib/publishers";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { AdminReports, type ReportedRow } from "./AdminReports";

type ReportRecord = {
  presentation_id: string;
  reason: ReportReason;
  note: string;
  created_at: string;
  presentation: { title: string; owner_id: string; hidden_at: string | null };
};

type HiddenRecord = { id: string; title: string; owner_id: string; hidden_at: string };

/**
 * Admin → Reports: presentations teachers reported (most reported first), and the ones admins hid.
 * (../layout.tsx checks the user is an admin.)
 */
export default async function AdminReportsPage() {
  const supabase = await createClient();
  const [reports, hidden] = await Promise.all([
    supabase
      .from("presentation_reports")
      .select("presentation_id, reason, note, created_at, presentation:presentations(title, owner_id, hidden_at)")
      .order("created_at", { ascending: false }),
    supabase
      .from("presentations")
      .select("id, title, owner_id, hidden_at")
      .not("hidden_at", "is", null)
      .order("hidden_at", { ascending: false }),
  ]);
  if (reports.error) throw reports.error;
  if (hidden.error) throw hidden.error;

  // A report belongs to one presentation, so `presentation` comes as one object (the untyped client guesses a list).
  const reportRecords = reports.data as unknown as ReportRecord[];
  const hiddenRecords: HiddenRecord[] = hidden.data;
  const names = await loadPublisherNames(supabase, [
    ...reportRecords.map((report) => report.presentation.owner_id),
    ...hiddenRecords.map((presentation) => presentation.owner_id),
  ]);
  return <AdminReports {...buildRows(reportRecords, hiddenRecords, names)} />;
}

/** One row per reported presentation (its reports newest first), and the hidden ones nobody reported. */
function buildRows(reportRecords: ReportRecord[], hiddenRecords: HiddenRecord[], names: Map<string, string>) {
  const now = Date.now();
  const reported = new Map<string, ReportedRow>();
  for (const report of reportRecords) {
    const row = reported.get(report.presentation_id) ?? {
      id: report.presentation_id,
      title: report.presentation.title || "Untitled presentation",
      meta: ownerLine(names.get(report.presentation.owner_id)),
      isHidden: report.presentation.hidden_at !== null,
      reports: [],
    };
    row.reports.push({
      reason: REPORT_REASON_LABELS[report.reason],
      note: report.note,
      when: timeAgo(Date.parse(report.created_at), now),
    });
    reported.set(report.presentation_id, row);
  }
  const reportedRows = [...reported.values()].sort((a, b) => b.reports.length - a.reports.length);

  // Hidden ones that still have reports are in the list above already.
  const hiddenRows = hiddenRecords
    .filter((presentation) => !reported.has(presentation.id))
    .map((presentation) => ({
      id: presentation.id,
      title: presentation.title || "Untitled presentation",
      meta: joinParts([ownerLine(names.get(presentation.owner_id)), `Hidden ${timeAgo(Date.parse(presentation.hidden_at), now)}`]),
      isHidden: true,
      reports: [],
    }));

  return { reportedRows, hiddenRows };
}

function ownerLine(name: string | undefined): string {
  return name ? `Published by ${name}` : "";
}
