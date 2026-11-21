"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { OPTION_LABELS, TEXT_DRAG_MIME } from "@/lib/constants";
import { createBlankSlide } from "@/lib/factories";
import { PLAIN_TEXT_MAX, type Slide } from "@/lib/schema";
import { TEXT_LIMIT_MESSAGE } from "@/lib/textLimit";
import { readWordFile } from "@/lib/wordFile";
import { PICKED_LINES_MAX, WORD_LINES_MAX, droppedTextHtml, pickedSlideTexts, suggestItems } from "@/lib/wordText";
import { Spinner } from "@/components/Spinner";
import { PanelLabel } from "./PanelControls";
import { CheckIcon, CopyIcon, FileTextIcon, FileUpIcon, GripVerticalIcon, InfoIcon, LightbulbIcon, PlusIcon, XIcon } from "lucide-react";

const DOCX_TYPES = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Sidebar panel that opens a Word file (.docx) in this tab and lists its text, one line per piece. A line is
 * dragged onto a question or answer box (`useElementDropTarget`'s text drop), or (touch screens) tapped by its
 * handle and then put in by a tap on a box (the store's `heldWordLine`), or copied. Ticked lines fill a
 * preview of a new question slide (the first ticked is the question, the next ones A–D, `pickedSlideTexts`), and
 * "Add as a new slide" adds it after the active slide. "Show suggestions" colors each numbered question and the
 * lines under it (`suggestItems`), with a Create button that adds that item as a slide. The file is never uploaded or saved; the list stays in the
 * store while the panel is closed (the ticks don't).
 */
export function WordFilePanel() {
  const closeWordPanel = useEditorStore((s) => s.closeWordPanel);
  const wordFile = useEditorStore((s) => s.wordFile);
  const setWordFile = useEditorStore((s) => s.setWordFile);
  const insertSlides = useEditorStore((s) => s.insertSlides);
  const heldWordLine = useEditorStore((s) => s.heldWordLine);
  const setHeldWordLine = useEditorStore((s) => s.setHeldWordLine);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticked line numbers, in the order they were ticked.
  const [picked, setPicked] = useState<number[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Question line numbers of the suggestions already made into slides.
  const [created, setCreated] = useState<number[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPanelEscape(e)) return;
      // Escape first lets go of a held line, then closes the panel.
      if (useEditorStore.getState().heldWordLine !== null) setHeldWordLine(null);
      else closeWordPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      setHeldWordLine(null);
    };
  }, [closeWordPanel, setHeldWordLine]);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    setIsReading(true);
    setError(null);
    // The browser can refuse to read a file (e.g. one still syncing or locked): say so instead of spinning forever.
    const result = await readWordFile(file).catch(() => ({
      error: "Couldn't read this file. Close it in Word, then try again.",
    }));
    setIsReading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setWordFile({ name: file.name, lines: result.lines, more: result.more });
    setPicked([]);
    setShowSuggestions(false);
    setCreated([]);
  };

  // Each suggested line's item and whether it's the question; only while suggestions show.
  const suggestions = useMemo(() => {
    const items = showSuggestions && wordFile ? suggestItems(wordFile.lines) : [];
    const byLine = new Map<number, { question: number; isQuestion: boolean; lines: number[] }>();
    for (const { question, options } of items) {
      const lines = [question, ...options];
      lines.forEach((line) => byLine.set(line, { question, isQuestion: line === question, lines }));
    }
    return { count: items.length, byLine };
  }, [showSuggestions, wordFile]);

  const copyLine = (line: string) => {
    navigator.clipboard.writeText(line).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn't copy. Select the text and copy it instead."),
    );
  };

  const togglePicked = (i: number) =>
    setPicked((now) => (now.includes(i) ? now.filter((n) => n !== i) : now.length < PICKED_LINES_MAX ? [...now, i] : now));

  const preview = wordFile ? pickedSlideTexts(wordFile.lines, picked) : null;

  /** Adds a choice slide from these lines (question, then A–D) after the active slide. True when it was added. */
  const addSlide = (lineNumbers: number[]): boolean => {
    if (!wordFile) return false;
    const { question, options } = pickedSlideTexts(wordFile.lines, lineNumbers);
    if ([question, ...options].some((text) => text.length > PLAIN_TEXT_MAX)) {
      toast.error(TEXT_LIMIT_MESSAGE, { id: "text-limit" });
      return false;
    }
    const blank = createBlankSlide("choice");
    const slide: Slide = {
      ...blank,
      question,
      questionHtml: question ? droppedTextHtml(undefined, question) : "",
      options: blank.options.map((option, i) =>
        options[i] ? { ...option, text: options[i], html: droppedTextHtml(undefined, options[i]) } : option,
      ) as Slide["options"],
    };
    const { presentation, selectedSlideId } = useEditorStore.getState();
    const before = presentation.slides.length;
    // insertSlides refuses past the slide limit, with its own toast.
    insertSlides([slide], selectedSlideId ? { slideId: selectedSlideId } : undefined);
    if (useEditorStore.getState().presentation.slides.length === before) return false;
    toast.success("Slide added");
    return true;
  };

  return (
    <div className="relative flex shrink-0">
      <div
        data-keep-container-selection="true"
        // Only the list of lines scrolls: the buttons, the preview and the help above it stay in place.
        className="flex shrink-0 flex-col gap-4 overflow-hidden border-r border-border-default bg-bg-surface side-panel"
      >
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-text-primary">Word file</h2>
          <button
            type="button"
            onClick={closeWordPanel}
            title="Close (Esc)"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            <XIcon size={16} />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={DOCX_TYPES}
          className="hidden"
          data-word-file-input
          onChange={(e) => {
            void openFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {!wordFile && (
          <p className="shrink-0 text-xs text-text-secondary">
            Open your exam in Word format (.docx). Then drag each line onto a question or an answer choice. The file stays
            on your computer.
          </p>
        )}

        {!wordFile && (
          <button
            type="button"
            disabled={isReading}
            onClick={() => inputRef.current?.click()}
            className="flex shrink-0 items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {isReading ? <Spinner size={16} /> : <FileTextIcon size={16} />}
            Open a Word file
          </button>
        )}

        {error && <p className="shrink-0 rounded-dropdown bg-danger-soft px-3 py-2 text-xs text-danger-strong">{error}</p>}

        {heldWordLine !== null && (
          <div
            data-word-held
            className="flex shrink-0 items-center justify-between gap-2 rounded-card border border-accent bg-accent-soft px-3 py-2 text-xs font-semibold text-accent"
          >
            Tap a question or answer box to put this line there.
            <button
              type="button"
              onClick={() => setHeldWordLine(null)}
              className="shrink-0 rounded-dropdown px-2 py-0.5 hover:bg-bg-surface"
            >
              Cancel
            </button>
          </div>
        )}

        {wordFile && (
          <section className="flex min-h-0 flex-1 flex-col gap-2">
            {/* One row: the file name and icon buttons (their words show on hover), so the list keeps the room. */}
            <div className="flex shrink-0 items-center gap-1">
              <FileTextIcon size={14} className="shrink-0 text-text-secondary" />
              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-text-secondary" title={wordFile.name}>
                {wordFile.name}
              </p>
              <IconButton label="Open another file" disabled={isReading} onClick={() => inputRef.current?.click()}>
                {isReading ? <Spinner size={14} /> : <FileUpIcon size={16} />}
              </IconButton>
              {wordFile.lines.length > 0 && (
                <IconButton
                  label={showSuggestions ? "Hide suggestions" : "Show suggestions"}
                  title={
                    showSuggestions
                      ? `Hide suggestions (${suggestions.count} ${suggestions.count === 1 ? "question" : "questions"} found)`
                      : "Show suggestions: each numbered line and the lines under it (up to 4) as one question, with Create"
                  }
                  isOn={showSuggestions}
                  onClick={() => setShowSuggestions((on) => !on)}
                >
                  <LightbulbIcon size={16} />
                  {showSuggestions && (
                    <span className="absolute -right-1 -top-1 min-w-4 rounded-dropdown bg-accent px-1 text-center text-[10px] font-bold leading-4 text-white">
                      {suggestions.count}
                    </span>
                  )}
                </IconButton>
              )}
              <span
                tabIndex={0}
                title="Tick a question and its answer choices to make a slide, drag a line onto a box, or tap a line's handle and then a box. Show suggestions finds numbered questions for you."
                aria-label="How to use this panel"
                className="flex h-8 w-8 shrink-0 cursor-help items-center justify-center rounded-dropdown text-text-secondary hover:bg-bg-page"
              >
                <InfoIcon size={16} />
              </span>
            </div>
            {wordFile.more && (
              <p className="shrink-0 text-xs text-text-secondary">Showing the first {WORD_LINES_MAX.toLocaleString()} lines.</p>
            )}
            {wordFile.lines.length === 0 && <p className="shrink-0 text-xs text-text-secondary">This file has no text.</p>}
            {showSuggestions && suggestions.count === 0 && (
              <p className="shrink-0 text-xs text-text-secondary">No numbered questions found. Tick lines or drag them instead.</p>
            )}
            <ul data-word-lines className="-mr-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2 [scrollbar-gutter:stable] [scrollbar-width:thin]">
              {wordFile.lines.map((line, i) => {
                const place = picked.indexOf(i);
                const suggestion = suggestions.byLine.get(i);
                const isCreated = suggestion?.isQuestion && created.includes(i);
                return (
                  <li
                    key={i}
                    data-word-line
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TEXT_DRAG_MIME, line);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    title="Drag onto a question or an answer choice, or tap the handle and then a box"
                    data-suggested={suggestion ? (suggestion.isQuestion ? "question" : "option") : undefined}
                    className={`group flex cursor-grab items-start gap-1.5 rounded-dropdown border py-1.5 pl-1 pr-1.5 text-sm text-text-primary hover:border-accent active:cursor-grabbing ${
                      place !== -1 || line === heldWordLine || suggestion ? "border-accent" : "border-border-default"
                    } ${suggestion?.isQuestion ? "bg-accent-soft" : "bg-bg-surface"} ${suggestion && !suggestion.isQuestion ? "ml-4 border-l-4" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => setHeldWordLine(line === heldWordLine ? null : line)}
                      aria-label="Pick up this line, then tap a box"
                      aria-pressed={line === heldWordLine}
                      className={`flex h-6 w-5 shrink-0 items-center justify-center rounded-dropdown ${
                        line === heldWordLine ? "bg-accent text-white" : "text-text-secondary hover:bg-accent-soft hover:text-accent"
                      }`}
                    >
                      <GripVerticalIcon size={14} />
                    </button>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={place !== -1}
                        disabled={place === -1 && picked.length >= PICKED_LINES_MAX}
                        onChange={() => togglePicked(i)}
                        aria-label="Use on a new slide"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                      />
                      {place !== -1 && (
                        <span className="mt-px shrink-0 rounded-dropdown bg-accent px-1 text-[11px] font-bold text-white">
                          {place === 0 ? "Q" : OPTION_LABELS[place - 1]}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 break-words">{line}</span>
                    </label>
                    {suggestion?.isQuestion && (
                      <button
                        type="button"
                        onClick={() => addSlide(suggestion.lines) && setCreated((now) => [...now, i])}
                        title={isCreated ? "Added. Click to add it again." : "Add this question and its choices as a new slide"}
                        className={`flex h-6 shrink-0 items-center gap-1 rounded-dropdown px-2 text-xs font-semibold ${
                          isCreated ? "bg-success-soft text-success-strong" : "bg-accent text-white hover:bg-accent-hover"
                        }`}
                      >
                        {isCreated ? <CheckIcon size={12} /> : <PlusIcon size={12} />}
                        {isCreated ? "Added" : "Create"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => copyLine(line)}
                      title="Copy"
                      aria-label="Copy"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-dropdown text-text-secondary hover:bg-accent-soft hover:text-accent"
                    >
                      <CopyIcon size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
        {preview && picked.length > 0 && (
          <section
            data-word-preview
            data-keep-container-selection="true"
            // Beside the panel, at the top, over the slides: the list keeps all its room.
            className="absolute left-full top-3 z-30 ml-3 flex w-72 flex-col gap-2 rounded-card border border-accent bg-accent-soft p-3"
          >
            <div className="flex items-center justify-between">
              <PanelLabel>New slide</PanelLabel>
              <button
                type="button"
                onClick={() => setPicked([])}
                className="rounded-dropdown px-2 py-0.5 text-xs font-semibold text-accent hover:bg-bg-surface"
              >
                Clear
              </button>
            </div>
            <PreviewBox label="Q" text={preview.question} />
            <div className="grid grid-cols-2 gap-1.5">
              {preview.options.map((text, i) => (
                <PreviewBox key={i} label={OPTION_LABELS[i]} text={text} />
              ))}
            </div>
            {picked.length >= 2 ? (
              <button
                type="button"
                onClick={() => addSlide(picked) && setPicked([])}
                className="flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                <PlusIcon size={16} />
                Add as a new slide
              </button>
            ) : (
              <p className="text-xs text-text-secondary">Now tick the answer choices, in order.</p>
            )}
          </section>
        )}
    </div>
  );
}

/** One box of the new slide's preview: its label (Q, A–D) and the ticked line, or a dash while empty. */
function PreviewBox({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 rounded-dropdown border border-border-default bg-bg-surface px-2 py-1.5 text-xs">
      <span className="shrink-0 font-bold text-accent">{label}</span>
      <span className={`line-clamp-2 min-w-0 break-words ${text ? "text-text-primary" : "text-text-secondary"}`}>
        {text || "—"}
      </span>
    </div>
  );
}

/** A small icon button in the file row; its words show on hover (`title`) and to screen readers (`label`). */
function IconButton({
  label,
  title = label,
  isOn,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  // Set only for a switch (Show suggestions): it then reads as pressed or not.
  isOn?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isOn}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown disabled:opacity-50 ${
        isOn ? "bg-accent-soft text-accent" : "text-text-primary hover:bg-bg-page"
      }`}
    >
      {children}
    </button>
  );
}
