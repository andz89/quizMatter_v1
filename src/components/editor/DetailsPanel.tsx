"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { DETAIL_MAX_LENGTH, GRADES, MAX_REFERENCE_LINKS, isWebLink, referenceSchema, type LessonDetails } from "@/lib/schema";
import { PanelLabel } from "./PanelControls";
import { CloseIcon } from "@/components/icons/CloseIcon";
import { Spinner } from "@/components/Spinner";

/**
 * Sidebar panel for the lesson as a whole: title, description, grade, subject, curriculum,
 * learning competency, author, references, and private/published. All optional. Edits count as unsaved
 * changes until Save, like any other edit — except private/published, which saves right away.
 */
export function DetailsPanel() {
  const closeDetailsPanel = useEditorStore((s) => s.closeDetailsPanel);
  const setLessonDetails = useEditorStore((s) => s.setLessonDetails);
  const setPublished = useEditorStore((s) => s.setPublished);
  const isSaving = useEditorStore((s) => s.saveStatus === "saving");
  // Which button was clicked, so only that one shows the spinner.
  const [pendingVisibility, setPendingVisibility] = useState<boolean | null>(null);
  const quiz = useEditorStore((s) => s.quiz);
  const publishedBy = useLoggedInEmail();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetailsPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDetailsPanel]);

  const changeVisibility = async (isPublished: boolean) => {
    if (isPublished === quiz.isPublished) return;
    setPendingVisibility(isPublished);
    const saved = await setPublished(isPublished);
    setPendingVisibility(null);
    if (!saved) toast.error("Couldn't change it. Please try again.");
    else if (isPublished) toast.success("Lesson published — other teachers can see it now.");
    else toast.success("Lesson is private now.");
  };

  const textField = (key: keyof typeof DETAIL_MAX_LENGTH, label: string, placeholder: string, multiline = false) => (
    <Field label={label}>
      {multiline ? (
        <textarea
          value={quiz[key]}
          onChange={(e) => setLessonDetails({ [key]: e.target.value })}
          placeholder={placeholder}
          maxLength={DETAIL_MAX_LENGTH[key]}
          rows={3}
          className={`${inputClass} resize-y`}
        />
      ) : (
        <input
          value={quiz[key]}
          onChange={(e) => setLessonDetails({ [key]: e.target.value })}
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
        <h2 className="text-[15px] font-semibold text-text-primary">Lesson details</h2>
        <button
          type="button"
          onClick={closeDetailsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <CloseIcon />
        </button>
      </div>

      {textField("title", "Title", "Untitled lesson")}
      {textField("description", "Description", "What the lesson covers", true)}

      <Field label="Grade">
        <select
          value={quiz.grade}
          onChange={(e) => setLessonDetails({ grade: e.target.value as LessonDetails["grade"] })}
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
      {textField("learningCompetency", "Learning competency", "The competency this lesson targets, with its code", true)}
      {textField("author", "Author", "Who wrote it: you, a book, another teacher…")}

      <ReferenceLinks links={quiz.referenceLinks} onChange={(referenceLinks) => setLessonDetails({ referenceLinks })} />

      <Field label="Visibility">
        <div className="grid grid-cols-2 gap-1 rounded-button bg-bg-page p-1">
          {[
            { label: "Private", value: false },
            { label: "Published", value: true },
          ].map(({ label, value }) => (
            <button
              key={label}
              type="button"
              onClick={() => changeVisibility(value)}
              disabled={isSaving}
              className={`flex items-center justify-center gap-2 rounded-dropdown py-1.5 text-sm transition-colors disabled:cursor-default ${
                quiz.isPublished === value
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

      <Field label="Published by">
        <p className="truncate text-sm text-text-primary">{publishedBy ?? "—"}</p>
      </Field>
    </div>
  );
}

/**
 * One input per reference (a link, or a book / module name), plus "+ Add reference". Links get an
 * open button. Empty rows are dropped when the lesson is saved.
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
                  <OpenLinkIcon />
                </a>
              )}
              <button
                type="button"
                onClick={() => onChange(links.filter((_, i) => i !== index))}
                title="Remove link"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
              >
                <CloseIcon />
              </button>
            </div>
            {!isValid && <p className="text-[13px] text-red-600">A link must start with http:// or https://</p>}
          </div>
        );
      })}
      {links.length < MAX_REFERENCE_LINKS && (
        <button
          type="button"
          onClick={() => onChange([...links, ""])}
          className="w-fit text-sm font-semibold text-accent-green hover:opacity-80"
        >
          + Add reference
        </button>
      )}
    </div>
  );
}

function OpenLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h4v4M13 3L7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </svg>
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

/** Who's logged in. They're the one publishing: a lesson's owner is whoever saves it. */
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
