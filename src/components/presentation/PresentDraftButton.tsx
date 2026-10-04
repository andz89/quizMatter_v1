"use client";

import dynamic from "next/dynamic";
import { PlayIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import type { Presentation } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

// Only downloaded when Present is clicked; the Spinner shows over the page meanwhile.
const PresentationView = dynamic(
  () => import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView),
  {
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <Spinner />
      </div>
    ),
  },
);

/**
 * "Present" for a presentation that isn't open in the editor, e.g. a review's submitted version (the reviewer's
 * view-only page and the admin's review page). Shows it fullscreen, from slide 1.
 */
export function PresentDraftButton({ presentation, className }: { presentation: Presentation; className: string }) {
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
    <>
      <button type="button" onClick={present} className={`inline-flex items-center gap-2 ${className}`}>
        <PlayIcon size={14} fill="currentColor" />
        Present
      </button>
      {isPresenting && <PresentationView />}
    </>
  );
}
