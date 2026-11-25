"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CircleCheckIcon, DownloadIcon, FileTextIcon, FileTypeIcon } from "lucide-react";
import type { Presentation } from "@/lib/schema";
import { downloadPresentationText } from "@/lib/markdownExport";
import { parseSlideNumbers } from "@/lib/presentationOutline";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";

const labelClass = "mb-2 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";

const FORMATS = [
  { value: "word", title: "Word", hint: ".docx · with photos", label: "Word (.docx)", Icon: FileTextIcon },
  { value: "text", title: "Text", hint: ".txt · plain text", label: "Text (.txt)", Icon: FileTypeIcon },
] as const;

/**
 * The download button, only on the editor's top bar (the owner, an admin, or a reviewer on their draft). It opens the Download box: Word (.docx) or
 * Text (.txt), and All slides or Custom (slide numbers typed like "1-3, 5", their places in the slide list;
 * `parseSlideNumbers`). `getPresentation` is asked when the box opens, so the editor gives what it shows then
 * (unsaved edits too). The Word code (`wordExport.ts` and the `docx` package) loads only on a Word download; the
 * Spinner shows while it and the photos load, and the box can't close meanwhile. Photos it couldn't read stay links,
 * and a toast says how many.
 */
export function DownloadButton({ getPresentation, className, iconSize }: { getPresentation: () => Presentation; className: string; iconSize: number }) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [format, setFormat] = useState<"word" | "text">("word");
  const [scope, setScope] = useState<"all" | "custom">("all");
  const [numbers, setNumbers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isMaking, setIsMaking] = useState(false);
  const formId = useId();

  const download = async (e: FormEvent) => {
    e.preventDefault();
    if (!presentation) return;
    let positions: number[] | undefined;
    if (scope === "custom") {
      const parsed = parseSlideNumbers(numbers, presentation.slides.length);
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }
      positions = parsed.numbers;
    }
    if (format === "text") {
      try {
        downloadPresentationText(presentation, positions);
        setPresentation(null);
      } catch {
        toast.error("Couldn't make the text file. Please try again.");
      }
      return;
    }
    setIsMaking(true);
    try {
      const { downloadPresentationWord } = await import("@/lib/wordExport");
      const { missingPhotos } = await downloadPresentationWord(presentation, positions);
      if (missingPhotos > 0) toast.warning(`${missingPhotos === 1 ? "1 photo" : `${missingPhotos} photos`} couldn't be added, so the file has a link instead.`);
      setPresentation(null);
    } catch {
      toast.error("Couldn't make the Word file. Please try again.");
    } finally {
      setIsMaking(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setPresentation(getPresentation());
        }}
        title="Download"
        aria-label="Download"
        className={className}
      >
        <DownloadIcon size={iconSize} />
      </button>
      {presentation && (
        <Modal
          title="Download"
          isNarrow
          isBusy={isMaking}
          onClose={() => setPresentation(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setPresentation(null)}
                disabled={isMaking}
                className="rounded-button px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="submit"
                form={formId}
                disabled={isMaking}
                className="btn-press flex items-center gap-2 rounded-button bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-70"
              >
                {isMaking ? <Spinner size={14} /> : <DownloadIcon size={16} />}
                Download
              </button>
            </>
          }
        >
          <form id={formId} onSubmit={download} className="flex flex-col gap-5">
            <fieldset>
              <legend className={labelClass}>Format</legend>
              <div className="grid grid-cols-2 gap-3">
                {FORMATS.map(({ value, title, hint, label, Icon }) => {
                  const isPicked = format === value;
                  return (
                    <label
                      key={value}
                      className={`relative flex cursor-pointer flex-col gap-3 rounded-button border p-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                        isPicked ? "border-accent bg-accent-soft" : "border-border-default bg-bg-surface hover:border-text-header"
                      }`}
                    >
                      <input type="radio" name="format" checked={isPicked} onChange={() => setFormat(value)} aria-label={label} className="absolute inset-0 cursor-pointer opacity-0" />
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-dropdown ${
                          isPicked ? "bg-accent text-white" : "bg-bg-page text-text-secondary"
                        }`}
                      >
                        <Icon size={18} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-text-primary">{title}</span>
                        <span className="block text-xs text-text-secondary">{hint}</span>
                      </span>
                      {isPicked && <CircleCheckIcon size={18} className="absolute top-3 right-3 text-accent" />}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className={labelClass}>Slides</legend>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-1 rounded-button border border-border-default bg-bg-page p-1">
                  {(
                    [
                      ["all", `All slides · ${presentation.slides.length}`],
                      ["custom", "Custom"],
                    ] as const
                  ).map(([value, text]) => (
                    <label
                      key={value}
                      className={`relative cursor-pointer rounded-dropdown border px-3 py-2 text-center text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                        scope === value ? "border-accent bg-accent-soft text-accent" : "border-transparent text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      <input type="radio" name="scope" checked={scope === value} onChange={() => setScope(value)} className="absolute inset-0 cursor-pointer opacity-0" />
                      {text}
                    </label>
                  ))}
                </div>
                {scope === "custom" && (
                  <div>
                    <input
                      type="text"
                      value={numbers}
                      onChange={(e) => {
                        setNumbers(e.target.value);
                        setError(null);
                      }}
                      placeholder="e.g. 1-3, 5, 8"
                      aria-label="Slide numbers"
                      autoFocus
                      className="w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
                    />
                    <p className={`mt-1 text-xs ${error ? "text-danger-strong" : "text-text-secondary"}`}>
                      {error ?? `Slide numbers from 1 to ${presentation.slides.length}, as in the slide list.`}
                    </p>
                  </div>
                )}
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
    </>
  );
}
