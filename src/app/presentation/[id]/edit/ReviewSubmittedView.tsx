"use client";

import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { PresentDraftButton } from "@/components/presentation/PresentDraftButton";
import { ReviewDraftView } from "@/components/presentation/ReviewDraftView";
import { joinParts, slideCountLabel } from "@/lib/format";
import { gradesLabel, gradesTitle, type Presentation, type ReviewerFields } from "@/lib/schema";

/**
 * What a reviewer sees after submitting: their version, view only (no editor, no tools), while QuizMatter
 * checks it. Present shows it fullscreen.
 */
export function ReviewSubmittedView({ presentation, fields }: { presentation: Presentation; fields: ReviewerFields }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <Link href={`/presentation/${presentation.id}`} className="text-sm text-text-secondary transition-colors hover:text-text-primary">
        ← Back to the presentation
        <LinkPending />
      </Link>

      <p className="mt-3 rounded-card bg-highlight-soft px-5 py-3 text-sm text-text-primary">
        Submitted. QuizMatter will publish your changes in 1–2 days. Until then you can look at your version, but not
        change it.
      </p>

      <header className="mt-4 mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-extrabold text-text-primary">{presentation.title || "Untitled presentation"}</h1>
          <p title={gradesTitle(presentation.grades)} className="mt-0.5 text-sm text-text-secondary">
            {joinParts([gradesLabel(presentation.grades), presentation.subject, slideCountLabel(presentation.slides.length)])}
          </p>
        </div>
        <PresentDraftButton
          presentation={presentation}
          className="ml-auto rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        />
      </header>

      <ReviewDraftView presentation={presentation} fields={fields} />
    </main>
  );
}
