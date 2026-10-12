import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { PresentDraftButton } from "@/components/presentation/PresentDraftButton";
import { ReviewDraftView } from "@/components/presentation/ReviewDraftView";
import { getAccount } from "@/lib/account";
import { loadPresentation } from "@/lib/fetchPresentation";
import { detailsLabel, joinParts, slideCountLabel } from "@/lib/format";
import { usesPeopleArt } from "@/lib/peopleArt";
import { gradesTitle } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { SubmissionDecision } from "./SubmissionDecision";

// "2026-10-12": the day it was submitted in the Philippines' time zone (like formatDate), not the UTC day.
const manilaDay = (time: string) => new Date(time).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

type SubmissionRow = { presentation_id: string; editor_name: string; editor_email: string; submitted_at: string };

/** An editor's presentation waiting for QuizMatter: view only, with Present, Send back and Approve. */
export default async function AdminSubmissionPage({ params }: PageProps<"/admin/presentations/submissions/[id]">) {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data, error }, result] = await Promise.all([supabase.rpc("admin_submissions"), loadPresentation(supabase, id)]);
  if (error) throw error;
  // Only waiting ones are in the list: decided already (or never submitted) = not found.
  const submission = (data as SubmissionRow[]).find((row) => row.presentation_id === id);
  if (!submission || !result) notFound();
  const { presentation } = result;

  return (
    <PeopleArtGate needed={usesPeopleArt(presentation.slides)}>
      <Link
        href="/admin/presentations/submissions"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
      >
        <ChevronLeftIcon size={16} />
        Submissions
        <LinkPending />
      </Link>

      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-text-primary">{presentation.title || "Untitled presentation"}</h2>
          <p title={gradesTitle(presentation.grades)} className="mt-0.5 text-sm text-text-secondary">
            {joinParts([detailsLabel(presentation), slideCountLabel(presentation.slides.length)])}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* It's locked while it waits, so this is exactly what Approve copies. */}
          <PresentDraftButton
            presentation={presentation}
            className="rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page"
          />
          <SubmissionDecision presentationId={id} />
        </div>
      </header>

      <ReviewDraftView
        presentation={presentation}
        byLabel="Submitted by"
        fields={{ name: submission.editor_name, email: submission.editor_email, reviewedOn: manilaDay(submission.submitted_at) }}
      />
    </PeopleArtGate>
  );
}
