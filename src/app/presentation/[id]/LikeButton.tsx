"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HeartIcon } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { REFUSALS } from "@/lib/presentations";
import { pauseFeature, useIsPaused } from "@/lib/clickLimits";
import { setPresentationLiked } from "./actions";

// What to tell the user when liking failed (also used by the card's heart, LikeCardButton).
export const LIKE_ERRORS = {
  banned: REFUSALS.QMBAN,
  failed: "Couldn't save your like. Please check your internet and try again.",
} as const;

/**
 * The heart and how many likes the presentation has (see the presentation_likes migration). `canLike` (a teacher or
 * an editor, on someone else's published presentation) makes it a button that likes it, or takes the like back
 * when it's filled; otherwise it only shows the count (admins, my own presentation).
 * Greyed out while liking is paused for clicking too fast (the notice at the bottom says until when).
 */
export function LikeButton({
  presentationId,
  likeCount: countAtStart,
  isLiked: likedAtStart,
  canLike,
  className,
}: {
  presentationId: string;
  likeCount: number;
  isLiked: boolean;
  canLike: boolean;
  className: string;
}) {
  const router = useRouter();
  const [likeCount, setLikeCount] = useState(countAtStart);
  const [isLiked, setIsLiked] = useState(likedAtStart);
  const [isPending, setIsPending] = useState(false);
  const isPaused = useIsPaused("like");
  const label = likeCount === 1 ? "1 like" : `${likeCount} likes`;

  if (!canLike) {
    return (
      <span title={label} className="inline-flex items-center justify-center gap-2 px-2 py-2 text-sm font-semibold text-text-secondary">
        <HeartIcon size={16} />
        {likeCount}
      </span>
    );
  }

  const toggle = async () => {
    setIsPending(true);
    const { status, pausedUntil } = await setPresentationLiked(presentationId, !isLiked);
    setIsPending(false);
    if (status === "done") {
      setIsLiked(!isLiked);
      setLikeCount((count) => Math.max(count + (isLiked ? -1 : 1), 0));
      toast.success(isLiked ? "Like removed." : "Liked.");
    } else if (status === "paused") {
      pauseFeature("like", pausedUntil!);
    } else {
      toast.error(LIKE_ERRORS[status]);
      // Just banned (e.g. automatically, for clicking too fast): load the page again once, so it says so.
      if (status === "banned") router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending || isPaused}
      aria-pressed={isLiked}
      aria-label={isLiked ? `Remove your like (${label})` : `Like (${label})`}
      title={isLiked ? "Remove your like" : "Like"}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      {isPending ? <Spinner size={14} /> : <HeartIcon size={16} className={isLiked ? "fill-accent text-accent" : ""} />}
      {likeCount}
    </button>
  );
}
