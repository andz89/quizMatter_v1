"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkIcon } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { MAX_SAVED } from "@/lib/schema";
import { REFUSALS } from "@/lib/presentations";
import { setPresentationSaved } from "./presentation/[id]/actions";

// What to tell the user when saving failed (also used by the preview page's Save button).
export const SAVE_ERRORS = {
  limit: `You have ${MAX_SAVED} saved presentations, the most allowed. Remove some to save new ones.`,
  tooFast: REFUSALS.QM429,
  banned: REFUSALS.QMBAN,
  failed: "Couldn't save. Please check your internet and try again.",
} as const;

/**
 * The bookmark on someone else's presentation card: saves it to my "Saved" row, or removes it when it's already
 * saved (filled). The page then gets fresh data, so every row shows the change; the spinner stays until it has.
 * `onChange` replaces that refresh (the editor's Presentations panel, where a refresh could disturb the editor).
 * `className` places it over the picture.
 */
export function SaveCardButton({
  presentationId,
  title,
  isSaved,
  onChange,
  className = "top-5 right-5",
}: {
  presentationId: string;
  title: string;
  isSaved: boolean;
  onChange?: (isSaved: boolean) => void;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const toggle = () =>
    startTransition(async () => {
      const result = await setPresentationSaved(presentationId, !isSaved);
      if (result !== "done") {
        toast.error(SAVE_ERRORS[result]);
        return;
      }
      toast.success(isSaved ? "Removed from Saved." : "Saved.");
      if (onChange) onChange(!isSaved);
      else router.refresh();
    });

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={isSaved}
      aria-label={isSaved ? `Remove ${title} from Saved` : `Save ${title}`}
      title={isSaved ? "Remove from Saved" : "Save"}
      className={`absolute z-20 flex ${className} h-7 w-7 items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-primary transition-colors hover:bg-bg-page`}
    >
      {isPending ? <Spinner size={14} /> : <BookmarkIcon size={16} className={isSaved ? "fill-accent text-accent" : ""} />}
    </button>
  );
}
