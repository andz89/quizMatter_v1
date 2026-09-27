"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBlankPresentation } from "@/lib/factories";
import { savePresentationToDb } from "@/lib/presentations";
import { createClient } from "@/lib/supabase/client";

/** Makes a blank presentation, saves it right away (so it has a row to open), then opens it in the editor. */
export function NewPresentationButton() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const createPresentation = async () => {
    setIsCreating(true);
    const presentation = createBlankPresentation();
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
      className="rounded-button bg-accent-navy px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {isCreating ? "Creating…" : "+ New presentation"}
    </button>
  );
}

export function LogoutButton() {
  const router = useRouter();

  const logOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={logOut}
      className="rounded-button px-3 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-surface"
    >
      Log out
    </button>
  );
}
