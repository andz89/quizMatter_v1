"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { LinkPending } from "@/components/LinkPending";
import { pauseFeature, pausedUntilFromError } from "@/lib/clickLimits";
import { saveErrorMessage, savePresentationToDb } from "@/lib/presentations";
import { DETAIL_MAX_LENGTH, type Presentation } from "@/lib/schema";
import { createClient } from "@/lib/supabase/client";
import { hasCopyTicket, removeCopyTicket, sendCopyResult } from "./copyTicket";

/** Why the server page won't copy it (`old`: saved by newer app code; the first tab isn't told about that one). */
export type CopyRefusal = { kind: "private" | "locked" | "old"; message: string };

const PAUSED = "You've made the most new presentations for today. It works again at midnight.";
const NO_TICKET = "This copy link only works from the Make a copy button.";

/**
 * Makes my private copy of the presentation as soon as the tab opens, under the id the button picked (`copyId`), then
 * replaces itself with the editor showing it. It saves only with the button's ticket (copyTicket.ts), and a copy
 * that's already there (a reload, a restored tab) just opens, so there's never a second one. A refusal is said here
 * and sent to the first tab. The copy is saved through `savePresentationToDb` (zod first), remembering `copied_from`.
 */
export function MakeCopy({
  presentationId,
  copyId,
  presentation,
  refusal,
}: {
  presentationId: string;
  copyId: string;
  presentation: Presentation | null;
  refusal: CopyRefusal | null;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState<{ message: string; backTo: string | null } | null>(null);
  // Only once, even when React runs the start twice (development).
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const openCopy = () => {
      removeCopyTicket(copyId);
      // Replaced, not added: Back goes to where the tab came from, not to this page.
      router.replace(`/presentation/${copyId}/edit`);
    };
    // The copy is already there (only I can see my private copy): open it.
    const copyExists = async () => {
      const { data } = await createClient().from("presentations").select("id").eq("id", copyId).maybeSingle();
      return data !== null;
    };

    const run = async () => {
      if (refusal) {
        if (refusal.kind !== "old") sendCopyResult({ presentationId, kind: refusal.kind });
        // Private: its page is "not found" now, so there's no way back to it.
        return setProblem({ message: refusal.message, backTo: refusal.kind === "private" ? null : presentationId });
      }
      if (await copyExists().catch(() => false)) return openCopy();
      if (!presentation || !hasCopyTicket(copyId, presentationId)) return setProblem({ message: NO_TICKET, backTo: presentationId });

      const now = Date.now();
      // Slide ids can stay: a slide's id only has to be unique inside its own presentation.
      // "Copy of …" so it's easy to tell apart from the original. `author` stays: it credits who wrote the content
      // (an editor's copy gets the editor as Author from the database instead, see the editor_author_and_copy_source
      // migration, which also keeps where it was copied from for the admin's Submissions page).
      const title = `Copy of ${presentation.title || "Untitled presentation"}`.slice(0, DETAIL_MAX_LENGTH.title);
      const copy = { ...presentation, id: copyId, title, isPublished: false, fromAdmin: false, createdAt: now, updatedAt: now };
      try {
        await savePresentationToDb(copy, { copiedFrom: presentationId });
        openCopy();
      } catch (error) {
        // A reload while the first save was still on its way: that one made it.
        if (await copyExists().catch(() => false)) return openCopy();
        // Paused (too many new presentations today): the first tab greys out its button too.
        const pausedUntil = pausedUntilFromError(error as { code?: string; details?: string });
        if (pausedUntil) {
          pauseFeature("create", pausedUntil);
          sendCopyResult({ presentationId, kind: "paused", pausedUntil });
          return setProblem({ message: PAUSED, backTo: presentationId });
        }
        setProblem({ message: saveErrorMessage(error, "make a copy"), backTo: presentationId });
      }
    };
    run();
  }, [presentationId, copyId, presentation, refusal, router]);

  if (problem) return <CopyProblem backTo={problem.backTo} message={problem.message} />;
  return (
    <div className="flex flex-col items-center gap-4 text-sm text-text-secondary">
      <TopLoadingBar />
      <Spinner size={32} />
      <p>Making your copy…</p>
    </div>
  );
}

/** Why there's no copy, and the way back: to the presentation (`backTo`), or home when it can't be opened. */
export function CopyProblem({ backTo, message }: { backTo: string | null; message: string }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 text-center">
      <p className="text-sm text-text-primary">{message}</p>
      <Link
        href={backTo ? `/presentation/${backTo}` : "/"}
        className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary"
      >
        {backTo ? "Back to the presentation" : "Go home"}
        <LinkPending />
      </Link>
    </div>
  );
}
