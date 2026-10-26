"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartIcon } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { pauseFeature, useIsPaused } from "@/lib/clickLimits";
import { setPresentationLiked } from "./presentation/[id]/actions";
import { LIKE_ERRORS } from "./presentation/[id]/LikeButton";

/**
 * The heart and like count on someone else's presentation card, left of the bookmark: likes it, or takes the like
 * back when it's filled (see the presentation_likes migration). It keeps its own count, so no page refresh.
 * Greyed out while liking is paused for clicking too fast (the notice at the bottom says until when).
 */
export function LikeCardButton({
  presentationId,
  title,
  likeCount: countAtStart,
  isLiked: likedAtStart,
}: {
  presentationId: string;
  title: string;
  likeCount: number;
  isLiked: boolean;
}) {
  const router = useRouter();
  const [likeCount, setLikeCount] = useState(countAtStart);
  const [isLiked, setIsLiked] = useState(likedAtStart);
  const [isPending, startTransition] = useTransition();
  const isPaused = useIsPaused("like");

  const toggle = () =>
    startTransition(async () => {
      let result;
      try {
        result = await setPresentationLiked(presentationId, !isLiked);
      } catch {
        // A network error: the transition ends, so the spinner stops.
        toast.error("Couldn't change it. Please try again.");
        return;
      }
      const { status, pausedUntil } = result;
      if (status === "paused") {
        pauseFeature("like", pausedUntil!);
        return;
      }
      if (status !== "done") {
        toast.error(LIKE_ERRORS[status]);
        // Just banned (e.g. automatically, for clicking too fast): load the page again once, so it says so.
        if (status === "banned") router.refresh();
        return;
      }
      toast.success(isLiked ? "Like removed." : "Liked.");
      setIsLiked(!isLiked);
      setLikeCount((count) => Math.max(count + (isLiked ? -1 : 1), 0));
    });

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending || isPaused}
      aria-pressed={isLiked}
      aria-label={isLiked ? `Remove your like from ${title}` : `Like ${title}`}
      title={isLiked ? "Remove your like" : "Like"}
      className="absolute top-5 right-14 z-20 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-border-default bg-bg-surface px-2 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-40 disabled:hover:bg-bg-surface"
    >
      {isPending ? <Spinner size={14} /> : <HeartIcon size={14} className={isLiked ? "fill-accent text-accent" : ""} />}
      {likeCount > 0 && likeCount}
    </button>
  );
}
