"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { LinkPending } from "@/components/LinkPending";
import { pauseFeature, pausedUntilFromError } from "@/lib/clickLimits";
import { createId } from "@/lib/id";
import { REFUSALS, saveErrorMessage, savePresentationToDb } from "@/lib/presentations";
import { loadReviewStatus } from "@/lib/reviewStatus";
import { DETAIL_MAX_LENGTH, isNewerThanApp, type Presentation } from "@/lib/schema";
import { createClient } from "@/lib/supabase/client";

// What the page says when the copy can't be made.
const PAUSED = "You've made the most new presentations for today. It works again at midnight.";

/**
 * Makes a private copy of the presentation for me (once, as soon as the tab opens), then turns into the editor
 * with it. "Make a copy" (PresentationDetails) opens this page in a new tab, so the list and the modal stay where
 * they were. The copy is saved through `savePresentationToDb` (zod first), remembering `copied_from`.
 */
export function MakeCopy({ presentation }: { presentation: Presentation }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  // Only one copy, even when React runs the start twice (development) or the page draws again.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const makeCopy = async () => {
      // It may have gone private (or hidden), or under review, since the teacher looked at it.
      try {
        const supabase = createClient();
        // The database hides someone else's private presentation, so finding nothing means it's private now.
        const { data: stillVisible, error } = await supabase.from("presentations").select("id, data_version").eq("id", presentation.id).maybeSingle();
        if (!error && !stillVisible) return setProblem("This presentation is private now, so it can't be copied.");
        // Saved by newer app code than this tab runs: copying it here would drop fields this tab doesn't know.
        if (stillVisible && isNewerThanApp(stillVisible.data_version)) return setProblem(REFUSALS.QMOLD);
        if ((await loadReviewStatus(supabase, presentation.id)).isLocked) {
          return setProblem("This presentation is under review, so it can't be copied right now.");
        }
      } catch {
        // The check failed (connection): the copy below fails too and says so.
      }
      const now = Date.now();
      // Slide ids can stay: a slide's id only has to be unique inside its own presentation.
      // "Copy of …" so it's easy to tell apart from the original. `author` stays: it credits who wrote the content
      // (an editor's copy gets the editor as Author from the database instead, see the editor_author_and_copy_source
      // migration, which also keeps where it was copied from for the admin's Submissions page).
      const title = `Copy of ${presentation.title || "Untitled presentation"}`.slice(0, DETAIL_MAX_LENGTH.title);
      const copy = { ...presentation, id: createId(), title, isPublished: false, fromAdmin: false, createdAt: now, updatedAt: now };
      try {
        await savePresentationToDb(copy, { copiedFrom: presentation.id });
        // Replaced, not added: Back (or a reload) never makes a second copy.
        router.replace(`/presentation/${copy.id}/edit`);
      } catch (error) {
        // Paused (too many new presentations today): the notice at the bottom says until when, too.
        const pausedUntil = pausedUntilFromError(error as { code?: string; details?: string });
        if (pausedUntil) {
          pauseFeature("create", pausedUntil);
          setProblem(PAUSED);
        } else {
          setProblem(saveErrorMessage(error, "make a copy"));
        }
      }
    };
    makeCopy();
  }, [presentation, router]);

  if (problem) return <CopyProblem presentationId={presentation.id} message={problem} />;
  return (
    <div className="flex flex-col items-center gap-4 text-sm text-text-secondary">
      <TopLoadingBar />
      <Spinner size={32} />
      <p>Making your copy…</p>
    </div>
  );
}

/** Why there's no copy, and the way back to the presentation. */
export function CopyProblem({ presentationId, message }: { presentationId: string | null; message: string }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 text-center">
      <p className="text-sm text-text-primary">{message}</p>
      <Link
        href={presentationId ? `/presentation/${presentationId}` : "/"}
        className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary"
      >
        {presentationId ? "Back to the presentation" : "Go home"}
        <LinkPending />
      </Link>
    </div>
  );
}
