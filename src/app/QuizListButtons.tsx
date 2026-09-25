"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBlankQuiz } from "@/lib/factories";
import { saveQuizToDb } from "@/lib/quizzes";
import { createClient } from "@/lib/supabase/client";

/** Makes a blank quiz, saves it right away (so it has a row to open), then opens it in the editor. */
export function NewQuizButton() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const createQuiz = async () => {
    setIsCreating(true);
    const quiz = createBlankQuiz();
    try {
      await saveQuizToDb(quiz);
      router.push(`/quiz/${quiz.id}`);
    } catch {
      alert("Couldn't create the lesson. Please try again.");
      setIsCreating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={createQuiz}
      disabled={isCreating}
      className="rounded-button bg-accent-navy px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {isCreating ? "Creating…" : "+ New lesson"}
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
