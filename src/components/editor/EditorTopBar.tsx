"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { buildSlides, getClaudeFormat } from "@/lib/importQuiz";
import { useEditorStore } from "@/lib/store";
import { SelectedElementToolbar } from "./SelectedElementToolbar";
import { TextFormatToolbar } from "./TextFormatToolbar";
import { ShapeBoxToolbar } from "./ShapeBoxToolbar";

export function EditorTopBar() {
  const title = useEditorStore((s) => s.quiz.title);
  const setQuizTitle = useEditorStore((s) => s.setQuizTitle);
  const startPresentation = useEditorStore((s) => s.startPresentation);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const activeTextEditor = useEditorStore((s) => s.activeTextEditor);
  const hasSelectedElements = useEditorStore((s) => s.selectedElementIds.length > 0);

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
      <BackToQuizzesLink />

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

      {activeTextEditor ? (
        <TextFormatToolbar editor={activeTextEditor} />
      ) : hasSelectedElements ? (
        <SelectedElementToolbar />
      ) : (
        <ShapeBoxToolbar />
      )}

      <ImportButtons />

      <SaveButton />

      <button
        type="button"
        onClick={handlePresent}
        title="Present (fullscreen)"
        className="flex items-center gap-2 rounded-button bg-accent-navy px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        <PlayIcon />
        Present
      </button>
    </header>
  );
}

/** Asks before leaving when there are unsaved changes (the browser's own "Leave page?" doesn't cover in-app links). */
function BackToQuizzesLink() {
  return (
    <Link
      href="/"
      title="My quizzes"
      onClick={(e) => {
        const { quiz, savedQuiz } = useEditorStore.getState();
        if (quiz !== savedQuiz && !confirm("You have unsaved changes. Leave without saving?")) e.preventDefault();
      }}
      className={historyButtonClass}
    >
      <BackIcon />
    </Link>
  );
}

/** Saves the quiz to the database (also Ctrl+S). A dot shows while there are unsaved changes. */
function SaveButton() {
  const saveQuiz = useEditorStore((s) => s.saveQuiz);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const hasUnsavedChanges = useEditorStore((s) => s.quiz !== s.savedQuiz);

  const label =
    saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Couldn't save — retry" : hasUnsavedChanges ? "Save" : "Saved";

  return (
    <button
      type="button"
      onClick={saveQuiz}
      disabled={saveStatus === "saving" || !hasUnsavedChanges}
      title="Save (Ctrl+S)"
      className="flex items-center gap-2 rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:hover:bg-transparent"
    >
      {hasUnsavedChanges && saveStatus !== "saving" && (
        <span className={`h-2 w-2 rounded-full ${saveStatus === "error" ? "bg-red-600" : "bg-accent-orange"}`} />
      )}
      <span className={saveStatus === "error" ? "text-red-600" : undefined}>{label}</span>
    </button>
  );
}

/**
 * "Copy format" puts the notes + JSON Schema for Claude on the clipboard. "Paste" (from the
 * clipboard) and "Import" (from a file) read the JSON Claude wrote and replace all slides with its slides.
 */
function ImportButtons() {
  const importSlides = useEditorStore((s) => s.importSlides);
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copyFormat = async () => {
    try {
      await navigator.clipboard.writeText(getClaudeFormat());
    } catch {
      // No clipboard on plain HTTP (e.g. testing from a phone on the LAN), or the browser said no.
      alert("The browser didn't allow copying to the clipboard.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const importText = (text: string) => {
    // Only the part from the first { to the last }, so a whole copied reply works too — Claude
    // usually wraps the JSON in ```json fences, sometimes with a sentence around it.
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      alert("That isn't valid JSON.");
      return;
    }
    const result = buildSlides(data);
    if ("errors" in result) alert(`Couldn't import:\n\n${result.errors.join("\n")}`);
    else importSlides(result.slides);
  };

  const pasteFromClipboard = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      alert("The browser didn't allow reading the clipboard. Allow it in the address bar, or use Import.");
      return;
    }
    importText(text);
  };

  return (
    <div className="ml-auto flex items-center">
      <button type="button" onClick={copyFormat} title="Copy the quiz format to paste into Claude" className={textButtonClass}>
        {copied ? "Copied!" : "Copy format"}
      </button>
      <button type="button" onClick={pasteFromClipboard} title="Add slides from JSON you copied (e.g. Claude's reply)" className={textButtonClass}>
        Paste
      </button>
      <button type="button" onClick={() => fileInput.current?.click()} title="Add slides from a JSON file" className={textButtonClass}>
        Import
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file again still triggers a change.
          e.target.value = "";
          if (file) file.text().then(importText);
        }}
      />
    </div>
  );
}

const textButtonClass =
  "rounded-button px-3 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page";

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

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
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
