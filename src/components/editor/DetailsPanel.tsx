"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { DETAIL_MAX_LENGTH, GRADES, MAX_REFERENCE_LINKS, isWebLink, referenceSchema, tagsSchema, type PresentationDetails } from "@/lib/schema";
import { parseTags } from "@/lib/photos";
import { PanelLabel } from "./PanelControls";
import { Spinner } from "@/components/Spinner";
import { ExternalLinkIcon, XIcon } from "lucide-react";

/**
 * Sidebar panel for the presentation as a whole: title, description, grade, subject, curriculum,
 * learning competency, tags, author, references, and private/published. All optional. Edits count as unsaved
 * changes until Save, like any other edit — except private/published, which saves right away.
 * For a QuizMatter presentation (made on Admin → Presentations) it's draft/shared instead: shared means every
 * teacher gets it under "From QuizMatter".
 */
export function DetailsPanel() {
  const closeDetailsPanel = useEditorStore((s) => s.closeDetailsPanel);
  const setPresentationDetails = useEditorStore((s) => s.setPresentationDetails);
  const setPublished = useEditorStore((s) => s.setPublished);
  const isSaving = useEditorStore((s) => s.saveStatus === "saving");
  // Which button was clicked, so only that one shows the spinner.
  const [pendingVisibility, setPendingVisibility] = useState<boolean | null>(null);
  const presentation = useEditorStore((s) => s.presentation);
  const publishedBy = useLoggedInEmail();
  const isAdmin = presentation.fromAdmin;
  // A reviewer can't change the author, sharing or publisher: those stay QuizMatter's.
  const isReview = useEditorStore((s) => s.review !== null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPanelEscape(e)) closeDetailsPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDetailsPanel]);

  const changeVisibility = async (isPublished: boolean) => {
    if (isPublished === presentation.isPublished) return;
    setPendingVisibility(isPublished);
    const saved = await setPublished(isPublished);
    setPendingVisibility(null);
    if (!saved) toast.error("Couldn't change it. Please try again.");
    else if (isPublished)
      toast.success(isAdmin ? "Shared — every teacher has it now." : "Presentation published — other teachers can see it now.");
    else toast.success(isAdmin ? "Back to a draft — only you can see it." : "Presentation is private now.");
  };

  const textField = (key: keyof typeof DETAIL_MAX_LENGTH, label: string, placeholder: string, multiline = false) => (
    <Field label={label}>
      {multiline ? (
        <textarea
          value={presentation[key]}
          onChange={(e) => setPresentationDetails({ [key]: e.target.value })}
          placeholder={placeholder}
          maxLength={DETAIL_MAX_LENGTH[key]}
          rows={3}
          className={`${inputClass} resize-y`}
        />
      ) : (
        <input
          value={presentation[key]}
          onChange={(e) => setPresentationDetails({ [key]: e.target.value })}
          placeholder={placeholder}
          maxLength={DETAIL_MAX_LENGTH[key]}
          className={inputClass}
        />
      )}
    </Field>
  );

  return (
    <div
      data-keep-container-selection="true"
      className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border-default bg-bg-surface p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold text-text-primary">Presentation details</h2>
        <button
          type="button"
          onClick={closeDetailsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <XIcon size={16} />
        </button>
      </div>

      {textField("title", "Title", "Untitled presentation")}
      {textField("description", "Description", "What the presentation covers", true)}

      <Field label="Grade">
        <select
          value={presentation.grade}
          onChange={(e) => setPresentationDetails({ grade: e.target.value as PresentationDetails["grade"] })}
          className={inputClass}
        >
          <option value="">Not set</option>
          {GRADES.map((grade) => (
            <option key={grade} value={grade}>
              {grade}
            </option>
          ))}
        </select>
      </Field>

      {textField("subject", "Subject", "e.g. Mathematics")}
      {textField("curriculum", "Curriculum", "e.g. MATATAG")}
      {textField("learningCompetency", "Learning competency", "The competency this presentation targets, with its code", true)}
      <TagsField tags={presentation.tags} onChange={(tags) => setPresentationDetails({ tags })} />
      {isReview ? (
        <Field label="Author">
          <p className="text-sm text-text-primary">{presentation.author || "—"}</p>
        </Field>
      ) : (
        textField("author", "Author", "Who wrote it: you, a book, another teacher…")
      )}

      <ReferenceLinks links={presentation.referenceLinks} onChange={(referenceLinks) => setPresentationDetails({ referenceLinks })} />

      {!isReview && (
        <Field label="Visibility">
          <div className="grid grid-cols-2 gap-1 rounded-button bg-bg-page p-1">
            {[
              { label: isAdmin ? "Draft" : "Private", value: false },
              { label: isAdmin ? "Shared" : "Published", value: true },
            ].map(({ label, value }) => (
              <button
                key={label}
                type="button"
                onClick={() => changeVisibility(value)}
                disabled={isSaving}
                className={`flex items-center justify-center gap-2 rounded-dropdown py-1.5 text-sm transition-colors disabled:cursor-default ${
                  presentation.isPublished === value
                    ? "bg-bg-surface font-semibold text-text-primary shadow-[0_0_0_1px_var(--border-default)]"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {pendingVisibility === value && <Spinner size={14} />}
                {label}
              </button>
            ))}
          </div>
        </Field>
      )}

      {isAdmin && !isReview && (
        <p className="-mt-3 text-[13px] text-text-secondary">Shared presentations go to every teacher, under “From QuizMatter”.</p>
      )}

      <Field label="Published by">
        <p className="truncate text-sm text-text-primary">{isReview ? "QuizMatter" : (publishedBy ?? "—")}</p>
      </Field>
    </div>
  );
}

/**
 * One input per reference (a link, or a book / module name), plus "+ Add reference". Links get an
 * open button. Empty rows are dropped when the presentation is saved.
 */
function ReferenceLinks({ links, onChange }: { links: string[]; onChange: (links: string[]) => void }) {
  const setLink = (index: number, value: string) => onChange(links.map((link, i) => (i === index ? value : link)));

  return (
    <div className="flex flex-col gap-2">
      <PanelLabel>References</PanelLabel>
      {links.map((link, index) => {
        const isValid = link.trim() === "" || referenceSchema.safeParse(link).success;
        return (
          <div key={index} className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input
                value={link}
                onChange={(e) => setLink(index, e.target.value)}
                placeholder="A link, or a book / module name"
                maxLength={500}
                aria-label={`Reference ${index + 1}`}
                className={`${inputClass} min-w-0 flex-1`}
              />
              {isWebLink(link.trim()) && (
                <a
                  href={link.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open link"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
                >
                  <ExternalLinkIcon size={16} />
                </a>
              )}
              <button
                type="button"
                onClick={() => onChange(links.filter((_, i) => i !== index))}
                title="Remove link"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
              >
                <XIcon size={16} />
              </button>
            </div>
            {!isValid && <p className="text-[13px] text-danger-strong">A link must start with http:// or https://</p>}
          </div>
        );
      })}
      {links.length < MAX_REFERENCE_LINKS && (
        <button
          type="button"
          onClick={() => onChange([...links, ""])}
          className="w-fit text-sm font-semibold text-accent hover:opacity-80"
        >
          + Add reference
        </button>
      )}
    </div>
  );
}

/**
 * Tags typed comma-separated, e.g. "fractions, addition". The text is kept as typed (so "fractions, " can be
 * typed), and the tags are read from it on every change. Search on the home page looks in them.
 */
function TagsField({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(tags.join(", "));
  // Tags changed somewhere else (e.g. undo): show them again.
  if (parseTags(text).join() !== tags.join()) setText(tags.join(", "));
  const error = tagsSchema.safeParse(tags).error?.issues[0].message;

  return (
    <Field label="Tags">
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseTags(e.target.value));
        }}
        placeholder="e.g. fractions, addition"
        className={inputClass}
      />
      {error ? (
        <p className="text-[13px] text-danger-strong">{error}</p>
      ) : (
        <p className="text-[13px] text-text-secondary">Put commas between tags. They help teachers find it when searching.</p>
      )}
    </Field>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <PanelLabel>{label}</PanelLabel>
      {children}
    </label>
  );
}

/** Who's logged in. They're the one publishing: a presentation's owner is whoever saves it. */
function useLoggedInEmail() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    createClient()
      .auth.getClaims()
      .then(({ data }) => setEmail(data?.claims.email ?? null));
  }, []);
  return email;
}

const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
