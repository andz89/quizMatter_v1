"use client";

import { useEditorStore } from "@/lib/store";
import { SelectedElementToolbar } from "./SelectedElementToolbar";
import { TextFormatToolbar } from "./TextFormatToolbar";

export function EditorTopBar() {
  const title = useEditorStore((s) => s.quiz.title);
  const setQuizTitle = useEditorStore((s) => s.setQuizTitle);
  const startPresentation = useEditorStore((s) => s.startPresentation);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const activeTextEditor = useEditorStore((s) => s.activeTextEditor);

  const handlePresent = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen isn't available (unsupported/blocked) — presentation still opens.
    }
    startPresentation();
  };

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border-default bg-bg-surface px-4">
      <input
        value={title}
        onChange={(e) => setQuizTitle(e.target.value)}
        placeholder="Untitled quiz"
        className="rounded-input px-2 py-1 text-[15px] font-semibold text-text-primary outline-none hover:bg-bg-page focus:bg-bg-page"
      />

      <div className="flex items-center">
        <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" className={historyButtonClass}>
          <UndoIcon />
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" className={historyButtonClass}>
          <UndoIcon flipped />
        </button>
      </div>

      {activeTextEditor ? <TextFormatToolbar editor={activeTextEditor} /> : <SelectedElementToolbar />}

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

const historyButtonClass =
  "flex h-9 w-9 items-center justify-center rounded-button text-text-primary transition-colors hover:bg-bg-page disabled:opacity-30 disabled:hover:bg-transparent";

/** Curved arrow pointing left (undo); `flipped` mirrors it into redo. */
function UndoIcon({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={flipped ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M3 2L12 7L3 12V2Z" />
    </svg>
  );
}
