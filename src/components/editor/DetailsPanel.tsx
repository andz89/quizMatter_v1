"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import {
  DETAIL_MAX_LENGTH,
  GRADES,
  MAX_REFERENCE_LINKS,
  OTHER_CHOICE,
  SUBJECTS,
  gradesLabel, gradesTitle,
  isOtherGrade,
  isWebLink,
  referenceSchema,
  tagsSchema,
} from "@/lib/schema";
import { parseTags } from "@/lib/photos";
import { PanelLabel } from "./PanelControls";
import { Spinner } from "@/components/Spinner";
import { ChevronDownIcon, ExternalLinkIcon, XIcon } from "lucide-react";

/**
 * Sidebar panel for the presentation as a whole: title, description, grade, subject, curriculum,
 * learning competency, tags and references. All optional. Edits count as unsaved changes until Save, like any
 * other edit. A teacher makes their own presentation private/published with the Share button in the top bar.
 * A QuizMatter presentation (made on Admin → Presentations) has a draft/shared switch here instead, which saves
 * right away: shared means every teacher gets it under "From QuizMatter".
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
    else toast.success(isPublished ? "Shared — every teacher has it now." : "Back to a draft — only you can see it.");
  };

  const textField = (key: Exclude<keyof typeof DETAIL_MAX_LENGTH, "grade">, label: string, placeholder: string, multiline = false) => (
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

      <GradesField grades={presentation.grades} onChange={(grades) => setPresentationDetails({ grades })} />
      <ListOrOtherField
        label="Subject"
        list={SUBJECTS}
        value={presentation.subject}
        onChange={(subject) => setPresentationDetails({ subject })}
        maxLength={DETAIL_MAX_LENGTH.subject}
        placeholder="Type the subject, e.g. Robotics"
      />
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

      {/* A teacher's own presentation is shared from the Share button in the top bar. */}
      {isAdmin && !isReview && (
        <Field label="Visibility">
          <div className="grid grid-cols-2 gap-1 rounded-button bg-bg-page p-1">
            {[
              { label: "Draft", value: false },
              { label: "Shared", value: true },
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
/**
 * The grades: a box showing the picked ones ("Grades 1–2"; "None" until one is ticked) that opens a list with a
 * checkbox per grade, then "Other…", which shows a box for the teacher's own grade (e.g. College).
 */
function GradesField({ grades, onChange }: { grades: string[]; onChange: (grades: string[]) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The teacher's own grade, as typed (kept here, so typing "Grade 1" on the way to "Grade 10" doesn't tick Grade 1).
  const [ownGrade, setOwnGrade] = useState(() => grades.find(isOtherGrade) ?? "");
  const [isOtherPicked, setIsOtherPicked] = useState(ownGrade !== "");
  const picked = GRADES.filter((grade) => grades.includes(grade));

  // In list order, with the teacher's own last (the order zod keeps too).
  const save = (listGrades: readonly string[], own: string) =>
    onChange([...GRADES.filter((grade) => listGrades.includes(grade)), ...(own.trim() ? [own] : [])]);
  const toggle = (grade: string) =>
    save(picked.includes(grade as (typeof GRADES)[number]) ? picked.filter((g) => g !== grade) : [...picked, grade], ownGrade);

  // Closes on a click outside, or on Esc.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const rowClass = "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-text-primary hover:bg-bg-page";
  return (
    <Field label="Grade">
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className={`${inputClass} flex items-center gap-2 text-left`}
        >
          <span title={gradesTitle(grades)} className="min-w-0 flex-1 truncate">{gradesLabel(grades) || "None"}</span>
          <ChevronDownIcon size={16} className="shrink-0" />
        </button>
        {isOpen && (
          <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-dropdown border border-border-default bg-bg-surface py-1">
            {GRADES.map((grade) => (
              <label key={grade} className={rowClass}>
                <input
                  type="checkbox"
                  checked={picked.includes(grade)}
                  onChange={() => toggle(grade)}
                  className="h-4 w-4 accent-accent"
                />
                {grade}
              </label>
            ))}
            <label className={rowClass}>
              <input
                type="checkbox"
                checked={isOtherPicked}
                onChange={(e) => {
                  setIsOtherPicked(e.target.checked);
                  if (e.target.checked) return;
                  setOwnGrade("");
                  save(picked, "");
                }}
                className="h-4 w-4 accent-accent"
              />
              Other…
            </label>
          </div>
        )}
      </div>
      {isOtherPicked && (
        <input
          value={ownGrade}
          onChange={(e) => {
            setOwnGrade(e.target.value);
            save(picked, e.target.value);
          }}
          placeholder="Type the grade, e.g. College"
          aria-label="Grade (your own)"
          maxLength={DETAIL_MAX_LENGTH.grade}
          className={`${inputClass} mt-2`}
        />
      )}
    </Field>
  );
}

/**
 * The subject: one from `list`, or "Other…" with a box to type the teacher's own. A value not on the list
 * opens as "Other…" with its text in the box. None by default: "None" shows until one is picked, but isn't in the
 * list to pick back.
 */
function ListOrOtherField({
  label,
  list,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string;
  list: readonly string[];
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder: string;
}) {
  // "Other…" picked but nothing typed yet (an empty value alone would show "None").
  const [isOtherPicked, setIsOtherPicked] = useState(false);
  const isOther = isOtherPicked || (value !== "" && !list.includes(value));

  return (
    <Field label={label}>
      <select
        value={isOther ? OTHER_CHOICE : value}
        onChange={(e) => {
          const picked = e.target.value;
          setIsOtherPicked(picked === OTHER_CHOICE);
          onChange(picked === OTHER_CHOICE ? "" : picked);
        }}
        className={inputClass}
      >
        <option value="" disabled hidden>
          None
        </option>
        {list.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={OTHER_CHOICE}>Other…</option>
      </select>
      {isOther && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={`${label} (your own)`}
          maxLength={maxLength}
          autoFocus={isOtherPicked}
          className={`${inputClass} mt-2`}
        />
      )}
    </Field>
  );
}

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
