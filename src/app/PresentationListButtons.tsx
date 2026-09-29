"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBlankPresentation } from "@/lib/factories";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { saveErrorMessage, savePresentationToDb } from "@/lib/presentations";

/**
 * Makes a blank presentation, saves it right away (so it has a row to open), then opens it in the editor.
 * `author` is the user's display name from the Account page ("" if not set), filled in as its Author.
 * `fromAdmin` makes a QuizMatter presentation (Admin → Presentations).
 */
export function NewPresentationButton({ author, fromAdmin = false }: { author: string; fromAdmin?: boolean }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const createPresentation = async () => {
    setIsCreating(true);
    const presentation = { ...createBlankPresentation({ author }), fromAdmin };
    try {
      await savePresentationToDb(presentation);
      router.push(`/presentation/${presentation.id}/edit`);
    } catch (error) {
      toast.error(saveErrorMessage(error, "create the presentation"));
      setIsCreating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={createPresentation}
      disabled={isCreating}
      className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
    >
      {isCreating && <Spinner size={14} />}
      {isCreating ? "Creating…" : "+ New presentation"}
    </button>
  );
}
