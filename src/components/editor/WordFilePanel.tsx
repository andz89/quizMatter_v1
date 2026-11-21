"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { TEXT_DRAG_MIME } from "@/lib/constants";
import { readWordFile } from "@/lib/wordFile";
import { WORD_LINES_MAX } from "@/lib/wordText";
import { Spinner } from "@/components/Spinner";
import { CopyIcon, FileTextIcon, GripVerticalIcon, XIcon } from "lucide-react";

const DOCX_TYPES = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Sidebar panel that opens a Word file (.docx) in this tab and lists its text, one line per piece. A line is
 * dragged onto a question or answer box (`useElementDropTarget`'s text drop), or copied. The file is never
 * uploaded or saved; the list stays in the store while the panel is closed.
 */
export function WordFilePanel() {
  const closeWordPanel = useEditorStore((s) => s.closeWordPanel);
  const wordFile = useEditorStore((s) => s.wordFile);
  const setWordFile = useEditorStore((s) => s.setWordFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPanelEscape(e)) closeWordPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeWordPanel]);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    setIsReading(true);
    setError(null);
    const result = await readWordFile(file);
    setIsReading(false);
    if ("error" in result) setError(result.error);
    else setWordFile({ name: file.name, lines: result.lines, more: result.more });
  };

  const copyLine = (line: string) => {
    navigator.clipboard.writeText(line).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn't copy. Select the text and copy it instead."),
    );
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

      {wordFile && (
        <section className="flex flex-col gap-2">
          <p className="truncate text-xs font-semibold text-text-secondary" title={wordFile.name}>
            {wordFile.name}
          </p>
          {wordFile.more && (
            <p className="text-xs text-text-secondary">Showing the first {WORD_LINES_MAX.toLocaleString()} lines.</p>
          )}
          {wordFile.lines.length === 0 && <p className="text-xs text-text-secondary">This file has no text.</p>}
          <ul className="flex flex-col gap-1.5">
            {wordFile.lines.map((line, i) => (
              <li
                key={i}
                data-word-line
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TEXT_DRAG_MIME, line);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                title="Drag onto a question or an answer choice"
                className="group flex cursor-grab items-start gap-1.5 rounded-dropdown border border-border-default bg-bg-surface py-1.5 pl-1 pr-1.5 text-sm text-text-primary hover:border-accent active:cursor-grabbing"
              >
                <GripVerticalIcon size={14} className="mt-0.5 shrink-0 text-text-secondary" />
                <span className="min-w-0 flex-1 break-words">{line}</span>
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
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
