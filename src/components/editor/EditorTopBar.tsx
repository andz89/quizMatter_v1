"use client";

import { useEditorStore } from "@/lib/store";
import { SelectedElementToolbar } from "./SelectedElementToolbar";

export function EditorTopBar() {
  const title = useEditorStore((s) => s.quiz.title);
  const setQuizTitle = useEditorStore((s) => s.setQuizTitle);
  const startPresentation = useEditorStore((s) => s.startPresentation);

  const handlePresent = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen isn't available (unsupported/blocked) — presentation still opens.
    }
    startPresentation();
  };

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-3 border-b border-border-default bg-bg-surface px-4">
      <input
        value={title}
        onChange={(e) => setQuizTitle(e.target.value)}
        placeholder="Untitled quiz"
        className="rounded-input px-2 py-1 text-[15px] font-semibold text-text-primary outline-none hover:bg-bg-page focus:bg-bg-page"
      />

      <SelectedElementToolbar />

      <button
        type="button"
        onClick={handlePresent}
        title="Present (fullscreen)"
        className="ml-auto flex items-center gap-2 rounded-button bg-accent-navy px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        <PlayIcon />
        Present
      </button>
    </header>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M3 2L12 7L3 12V2Z" />
    </svg>
  );
}
