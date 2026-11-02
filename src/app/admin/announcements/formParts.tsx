"use client";

import type { ReactNode } from "react";
import { EyeIcon } from "lucide-react";
import { ANNOUNCEMENT_LIMITS as L, type AnnouncementInput } from "@/lib/announcements";

// The small pieces the announcement form's sections share (AnnouncementForm.tsx and its *Section.tsx files), and
// their input styles.

export const labelClass = "mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";
export const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
export const checkClass = "h-4 w-4 accent-accent";

// "Closes itself after" starts here when picked.
const DEFAULT_AUTO_CLOSE = 30;

const toNumber = (value: string) => (value === "" ? null : Number(value));

/** Changes one field of the form (the sections get it from AnnouncementForm, which keeps the data). */
export type SetField = <K extends keyof AnnouncementInput>(key: K, value: AnnouncementInput[K]) => void;

/** A checkbox list's new value: `value` added (on) or taken out. */
export const toggleIn = <T extends string>(list: T[], value: T, on: boolean) =>
  on ? [...list, value] : list.filter((v) => v !== value);

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
      <h2 className="mb-3 text-[15px] font-extrabold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

/** The close delay, with Preview next to it (the section's last row). */
export function CloseAfter({ value, onChange, onPreview }: { value: number; onChange: (n: number) => void; onPreview: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
        The close button shows after
        <input
          type="number"
          min={0}
          max={L.closeAfter}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`${inputClass} w-20`}
        />
        seconds
      </label>
      <button
        type="button"
        onClick={onPreview}
        className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-page"
      >
        <EyeIcon size={16} />
        Preview
      </button>
    </div>
  );
}

/** The corner box's "Closes itself": never (0) or after a number of seconds. */
export function AutoClose({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <span className={labelClass}>Closes itself</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="radio" name="auto-close" checked={value === 0} onChange={() => onChange(0)} className={checkClass} />
          Never
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
          <input
            type="radio"
            name="auto-close"
            checked={value !== 0}
            onChange={() => onChange(DEFAULT_AUTO_CLOSE)}
            className={checkClass}
          />
          After
          <input
            type="number"
            min={L.autoCloseMin}
            max={L.autoCloseMax}
            value={value === 0 ? DEFAULT_AUTO_CLOSE : value}
            disabled={value === 0}
            // An emptied box (while typing a new number) isn't "never": only the Never choice is.
            onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))}
            className={`${inputClass} w-24 disabled:opacity-50`}
          />
          seconds ({L.autoCloseMin}–{L.autoCloseMax}; it counts as closed)
        </label>
      </div>
    </div>
  );
}

/** The sealed box's code and height (an HTML modal or top bar). */
export function HtmlBoxFields({
  id,
  html,
  onHtml,
  height,
  minHeight,
  maxHeight,
  onHeight,
}: {
  id: string;
  html: string;
  onHtml: (html: string) => void;
  height: number;
  minHeight: number;
  maxHeight: number;
  onHeight: (n: number) => void;
}) {
  return (
    <>
      <div>
        <label htmlFor={id} className={labelClass}>
          HTML
        </label>
        <textarea
          id={id}
          value={html}
          maxLength={L.modalHtml}
          rows={12}
          spellCheck={false}
          onChange={(e) => onHtml(e.target.value)}
          placeholder={'<h2 style="text-align:center">New lessons!</h2>\n<img src="https://images.quizmatter.com/uploads/…" style="width:100%">'}
          className={`${inputClass} resize-y`}
        />
        <p className="mt-1 text-[12px] text-text-secondary">
          Styles, scripts and pictures, fonts or code from other websites work. It runs in a sealed box: it
          can&apos;t reach QuizMatter or the teacher&apos;s login. Anything it loads from another website lets that
          site see the teacher&apos;s IP address. For our own pictures, copy a link from the Photos tab into
          &lt;img src=&quot;…&quot;&gt;. Links open in a new tab. Use Preview first: a script that never stops can
          freeze the teacher&apos;s page. {html.length}/{L.modalHtml}
        </p>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
        Box height
        <input
          type="number"
          min={minHeight}
          max={maxHeight}
          value={height}
          onChange={(e) => onHeight(Number(e.target.value))}
          className={`${inputClass} w-24`}
        />
        px ({minHeight}–{maxHeight}; taller content scrolls inside)
      </label>
    </>
  );
}

export function CheckRow<T extends string>({
  label,
  options,
  chosen,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  chosen: T[];
  onChange: (key: T, on: boolean) => void;
}) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label key={option.key} className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={chosen.includes(option.key)}
              onChange={(e) => onChange(option.key, e.target.checked)}
              className={checkClass}
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function FromTo({
  label,
  min,
  max,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  min: number;
  max: number;
  from: number | null;
  to: number | null;
  onFrom: (n: number | null) => void;
  onTo: (n: number | null) => void;
}) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="number"
          aria-label={`${label}: from`}
          min={min}
          max={max}
          value={from ?? ""}
          onChange={(e) => onFrom(toNumber(e.target.value))}
          placeholder="from"
          className={`${inputClass} w-24`}
        />
        to
        <input
          type="number"
          aria-label={`${label}: to`}
          min={min}
          max={max}
          value={to ?? ""}
          onChange={(e) => onTo(toNumber(e.target.value))}
          placeholder="to"
          className={`${inputClass} w-24`}
        />
      </div>
    </div>
  );
}

export function WordsInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
      <p className="mt-1 text-[12px] text-text-secondary">
        Separate them with commas. Up to {L.words} words; capital letters don&apos;t matter.
      </p>
    </div>
  );
}
