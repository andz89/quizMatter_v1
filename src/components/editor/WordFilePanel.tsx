"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { OPTION_LABELS, TEXT_DRAG_MIME } from "@/lib/constants";
import { createBlankSlide } from "@/lib/factories";
import { PLAIN_TEXT_MAX, type Slide } from "@/lib/schema";
import { TEXT_LIMIT_MESSAGE } from "@/lib/textLimit";
import { readWordFile } from "@/lib/wordFile";
import { PICKED_LINES_MAX, WORD_LINES_MAX, droppedTextHtml, pickedSlideTexts } from "@/lib/wordText";
import { Spinner } from "@/components/Spinner";
import { PanelLabel } from "./PanelControls";
import { CopyIcon, FileTextIcon, GripVerticalIcon, PlusIcon, XIcon } from "lucide-react";

const DOCX_TYPES = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Sidebar panel that opens a Word file (.docx) in this tab and lists its text, one line per piece. A line is
 * dragged onto a question or answer box (`useElementDropTarget`'s text drop), or (touch screens) tapped by its
 * handle and then put in by a tap on a box (the store's `heldWordLine`), or copied. Ticked lines fill a
 * preview of a new question slide (the first ticked is the question, the next ones A–D, `pickedSlideTexts`), and
 * "Add as a new slide" adds it after the active slide. The file is never uploaded or saved; the list stays in the
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
    const result = await readWordFile(file);
    setIsReading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setWordFile({ name: file.name, lines: result.lines, more: result.more });
    setPicked([]);
  };

  const copyLine = (line: string) => {
    navigator.clipboard.writeText(line).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn't copy. Select the text and copy it instead."),
    );
  };

  const togglePicked = (i: number) =>
    setPicked((now) => (now.includes(i) ? now.filter((n) => n !== i) : now.length < PICKED_LINES_MAX ? [...now, i] : now));

  const preview = wordFile ? pickedSlideTexts(wordFile.lines, picked) : null;

  const addSlide = () => {
    if (!preview) return;
    const { question, options } = preview;
    if ([question, ...options].some((text) => text.length > PLAIN_TEXT_MAX)) {
      toast.error(TEXT_LIMIT_MESSAGE, { id: "text-limit" });
      return;
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
    if (useEditorStore.getState().presentation.slides.length > before) {
      setPicked([]);
      toast.success("Slide added");
    }
  };

  return (
    <div
      data-keep-container-selection="true"
      className="flex shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-default bg-bg-surface side-panel"
    >
      <div className="flex items-center justify-between">
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
        <p className="text-xs text-text-secondary">
          Open your exam in Word format (.docx). Then drag each line onto a question or an answer choice. The file stays
          on your computer.
        </p>
      )}

      <button
        type="button"
        disabled={isReading}
        onClick={() => inputRef.current?.click()}
        className={
          wordFile
            ? "flex items-center justify-center gap-2 rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-page disabled:opacity-50"
            : "flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        }
      >
        {isReading ? <Spinner size={16} /> : <FileTextIcon size={16} />}
        {wordFile ? "Open another file" : "Open a Word file"}
      </button>

      {error && <p className="rounded-dropdown bg-danger-soft px-3 py-2 text-xs text-danger-strong">{error}</p>}

      {heldWordLine !== null && (
        <div
          data-word-held
          className="sticky top-0 z-20 flex items-center justify-between gap-2 rounded-card border border-accent bg-accent-soft px-3 py-2 text-xs font-semibold text-accent"
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

      {preview && picked.length > 0 && (
        <section
          data-word-preview
          className="sticky top-0 z-10 flex flex-col gap-2 rounded-card border border-accent bg-accent-soft p-3"
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
              onClick={addSlide}
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

      {wordFile && (
        <section className="flex flex-col gap-2">
          <p className="truncate text-xs font-semibold text-text-secondary" title={wordFile.name}>
            {wordFile.name}
          </p>
          {wordFile.more && (
            <p className="text-xs text-text-secondary">Showing the first {WORD_LINES_MAX.toLocaleString()} lines.</p>
          )}
          {wordFile.lines.length === 0 && <p className="text-xs text-text-secondary">This file has no text.</p>}
          {wordFile.lines.length > 0 && picked.length === 0 && (
            <p className="text-xs text-text-secondary">
              Tick a question and its answer choices to make a slide, or drag a line onto a box.
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {wordFile.lines.map((line, i) => {
              const place = picked.indexOf(i);
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
                  className={`group flex cursor-grab items-start gap-1.5 rounded-dropdown border bg-bg-surface py-1.5 pl-1 pr-1.5 text-sm text-text-primary hover:border-accent active:cursor-grabbing ${
                    place !== -1 || line === heldWordLine ? "border-accent" : "border-border-default"
                  }`}
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
