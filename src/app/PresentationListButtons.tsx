"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBlankPresentation } from "@/lib/factories";
import { savePresentationToDb } from "@/lib/presentations";

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
    } catch {
      alert("Couldn't create the presentation. Please try again.");
      setIsCreating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={createPresentation}
      disabled={isCreating}
      className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
    >
      {isCreating ? "Creating…" : "+ New presentation"}
    </button>
  );
}
