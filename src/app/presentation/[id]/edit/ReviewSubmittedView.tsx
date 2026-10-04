"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { ReviewDraftView } from "@/components/presentation/ReviewDraftView";
import { joinParts, slideCountLabel } from "@/lib/format";
import type { Presentation, ReviewerFields } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

// Only downloaded when the reviewer clicks Present.
const PresentationView = dynamic(() =>
  import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView)
);

/**
 * What a reviewer sees after submitting: their version, view only (no editor, no tools), while QuizMatter
 * checks it. Present shows it fullscreen.
 */
export function ReviewSubmittedView({ presentation, fields }: { presentation: Presentation; fields: ReviewerFields }) {
  const isPresenting = useEditorStore((s) => s.isPresenting);

  // The presentation view reads the editor's store, so the presentation goes in there first.
  const present = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen isn't available (unsupported/blocked) — presentation still opens.
    }
    const store = useEditorStore.getState();
    store.loadPresentation(presentation);
    store.startPresentation();
  };

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
          <p className="mt-0.5 text-sm text-text-secondary">
            {joinParts([presentation.grade, presentation.subject, slideCountLabel(presentation.slides.length)])}
          </p>
        </div>
        <button
          type="button"
          onClick={present}
          className="ml-auto rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Present
        </button>
      </header>

      <ReviewDraftView presentation={presentation} fields={fields} />
      {isPresenting && <PresentationView />}
    </main>
  );
}
