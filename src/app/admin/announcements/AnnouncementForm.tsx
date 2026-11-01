"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeIcon } from "lucide-react";
import { AnnouncementBar, AnnouncementModal } from "@/components/AnnouncementView";
import { Spinner } from "@/components/Spinner";
import { ConfirmModal } from "@/components/editor/ConfirmModal";
import {
  ANNOUNCEMENT_LIMITS as L,
  ANNOUNCEMENT_ROLES,
  DEFAULT_BAR_HEIGHT,
  DEFAULT_MODAL_HEIGHT,
  MODAL_SIZES,
  PAGE_GROUPS,
  REPEATS,
  REPEAT_LABELS,
  ROLE_LABELS,
  announcementSchema,
  type AnnouncementInput,
} from "@/lib/announcements";
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, GENDERS, GENDER_LABELS } from "@/lib/userSettings";
import { countAudience, saveAnnouncement } from "./actions";
import { AnnouncementTextEditor } from "./AnnouncementTextEditor";
import { ModalPostEditor } from "./ModalPostEditor";

const labelClass = "mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";
const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
const checkClass = "h-4 w-4 accent-accent";

const NEW_ANNOUNCEMENT: AnnouncementInput = {
  id: null,
  name: "",
  // Set by the button: Save as draft (off) or Save and turn on.
  is_on: false,
  starts_at: null,
  ends_at: null,
  show_modal: true,
  modal_text: "",
  modal_attachment: null,
  modal_close_after: 3,
  show_bar: false,
  bar_html: "",
  bar_close_after: 0,
  repeat: "once",
  pages: ["all"],
  genders: [],
  age_min: null,
  age_max: null,
  education_levels: [],
  field_words: [],
  presentations_min: null,
  presentations_max: null,
  roles: [],
  modal_size: "large",
  modal_format: "post",
  modal_html: "",
  modal_height: DEFAULT_MODAL_HEIGHT,
  bar_format: "text",
  bar_height: DEFAULT_BAR_HEIGHT,
};

// The Format choices: a post (text + one picture, video or post) or a text bar, or the admin's HTML in a sealed box.
const MODAL_FORMAT_CHOICES = [
  { key: "post", label: "Post (text + picture or video)" },
  { key: "html", label: "HTML (sealed box)" },
] as const;
const BAR_FORMAT_CHOICES = [
  { key: "text", label: "Text" },
  { key: "html", label: "HTML (sealed box)" },
] as const;

// The Type choice: an announcement is a modal or a top bar, never both.
const TYPES = [
  { label: "Modal", bar: false },
  { label: "Top bar (text only)", bar: true },
];

// What each "show again" choice means, under its name in the form (how it works: AnnouncementsWatch and
// my_announcements).
const REPEAT_HELP: Record<(typeof REPEATS)[number], { when: string; goodFor: string }> = {
  once: {
    when:
      "It shows until the teacher closes it, then never again for that teacher, on this computer or any other, even after they log out and back in.",
    goodFor: "news they only need to see once, e.g. \"New Grade 5 lessons are here.\"",
  },
  daily: {
    when:
      "It shows once a day. After the teacher closes it, it stays closed for the rest of that day, on any computer, and comes back after midnight (Philippine time).",
    goodFor: "a reminder during a short event, e.g. \"Training this week: sign up by Friday.\"",
  },
  every_visit: {
    when:
      "It shows each time the teacher opens QuizMatter in a new browser tab or window, or after they close and open the browser again. After they close it, it stays closed while they move between pages or reload in that same tab. It's remembered only in that tab, not on their account.",
    goodFor: "something important they should see every time they come back, e.g. \"QuizMatter will be down on Saturday night.\"",
  },
};

// The times are Philippine time (+08:00), whatever the computer's clock says. The box shows "YYYY-MM-DDTHH:mm".
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const toTimeInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + PH_OFFSET_MS).toISOString().slice(0, 16) : "");
const fromTimeInput = (value: string) => (value ? new Date(`${value}:00+08:00`).toISOString() : null);

// Word lists are typed as one line, comma separated.
const splitWords = (text: string) =>
  text
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
const toNumber = (value: string) => (value === "" ? null : Number(value));

/** The new / edit form: what it says, when and where it shows, and who sees it. Saves through saveAnnouncement. */
export function AnnouncementForm({ initial = NEW_ANNOUNCEMENT }: { initial?: AnnouncementInput }) {
  const router = useRouter();
  // bar_html holds the text bar's editor HTML or the html bar's code, by bar_format. The form keeps them apart
  // (form.bar_html for the text editor, barCode for the code box), so switching format loses neither.
  const [form, setForm] = useState(initial.bar_format === "html" ? { ...initial, bar_html: "" } : initial);
  const [barCode, setBarCode] = useState(initial.bar_format === "html" ? initial.bar_html : "");
  const barHtml = form.bar_format === "html" ? barCode : form.bar_html;
  const [fieldText, setFieldText] = useState(initial.field_words.join(", "));
  // The last "Count teachers" answer and the filters it was for (null = couldn't count, e.g. a filter isn't valid).
  const [counted, setCounted] = useState<{ filters: string; count: number | null } | null>(null);
  const [isCounting, startCounting] = useTransition();
  // A new number each time Preview is clicked, so the countdowns start again.
  const [preview, setPreview] = useState<{ key: number; modal: boolean; bar: boolean } | null>(null);
  const [isSaving, startSaving] = useTransition();
  // Which button is saving (true = turn on), for its spinner.
  const [savingOn, setSavingOn] = useState(false);
  // The name of the one of the same type that is on, when Save and turn on was refused for it (the box asks).
  const [conflict, setConflict] = useState<string | null>(null);
  const typeWord = form.show_bar ? "top bar" : "modal";

  const set =<K extends keyof AnnouncementInput>(key: K, value: AnnouncementInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = <T extends string>(list: T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));
  const input: AnnouncementInput = { ...form, bar_html: barHtml, field_words: splitWords(fieldText) };

  // "Count teachers" runs the matching rule over every account (slow with many teachers), so it's only asked on a
  // click, never while typing. Its answer shows only while the filters are still the ones it counted.
  const filters = JSON.stringify({
    genders: input.genders,
    age_min: input.age_min,
    age_max: input.age_max,
    education_levels: input.education_levels,
    field_words: input.field_words,
    presentations_min: input.presentations_min,
    presentations_max: input.presentations_max,
    roles: input.roles,
  });
  const countTeachers = () =>
    startCounting(async () => {
      setCounted({ filters, count: await countAudience({ ...NEW_ANNOUNCEMENT, ...JSON.parse(filters) }) });
    });
  const audience = counted?.filters === filters ? counted : null;

  // turnOn false = Save as draft. replaceCurrent: turn off the one of the same type that is on (after the box asked).
  const save = (turnOn: boolean, replaceCurrent = false) => {
    setConflict(null);
    // Checked here for a quick message; the server checks again before saving.
    // Only the chosen format's fields are saved; the other's stay in the form in case of a switch back.
    const sent = form.modal_format === "html" ? { ...input, modal_text: "", modal_attachment: null } : { ...input, modal_html: "" };
    const parsed = announcementSchema.safeParse({ ...sent, is_on: turnOn });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setSavingOn(turnOn);
    startSaving(async () => {
      const result = await saveAnnouncement(parsed.data, replaceCurrent);
      if ("conflict" in result) return setConflict(result.conflict);
      if ("error" in result) return void toast.error(result.error);
      if (result.countFailed) toast.warning("Saved, but the teachers couldn't be counted yet. Use Count again in the list.");
      else toast.success(turnOn ? "Announcement saved and on." : "Saved as a draft.");
      router.push("/admin/announcements");
    });
  };

  const showPreview = () => {
    const modal =
      form.show_modal &&
      (form.modal_format === "html"
        ? form.modal_html.trim() !== ""
        : form.modal_text.trim() !== "" || form.modal_attachment !== null);
    const bar = form.show_bar && barHtml.trim() !== "";
    if (!modal && !bar) return toast.error("Write the modal or the bar first.");
    setPreview({ key: Date.now(), modal, bar });
  };

  const isAllPages = form.pages.includes("all");

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Section title={form.id ? "Edit announcement" : "New announcement"}>
        <label htmlFor="announcement-name" className={labelClass}>
          Name (only admins see it)
        </label>
        <input
          id="announcement-name"
          value={form.name}
          maxLength={L.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. New lessons for Grade 5"
          className={inputClass}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="announcement-starts" className={labelClass}>
              Starts (Philippine time, optional)
            </label>
            <input
              id="announcement-starts"
              type="datetime-local"
              value={toTimeInput(form.starts_at)}
              onChange={(e) => set("starts_at", fromTimeInput(e.target.value))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="announcement-ends" className={labelClass}>
              Ends (Philippine time, optional)
            </label>
            <input
              id="announcement-ends"
              type="datetime-local"
              value={toTimeInput(form.ends_at)}
              onChange={(e) => set("ends_at", fromTimeInput(e.target.value))}
              className={inputClass}
            />
          </div>
        </div>
      </Section>

      {/* One type per announcement. Switching keeps what was typed in the other one; only the chosen one is saved on. */}
      <Section title="Type">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {TYPES.map((type) => (
            <label key={type.label} className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="radio"
                name="announcement-type"
                checked={form.show_bar === type.bar}
                onChange={() => setForm((f) => ({ ...f, show_modal: !type.bar, show_bar: type.bar }))}
                className={checkClass}
              />
              {type.label}
            </label>
          ))}
        </div>
      </Section>

      {form.show_modal && (
        <Section title="Modal">
          <div className="flex flex-col gap-3">
            <div>
              <span className={labelClass}>Format</span>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {MODAL_FORMAT_CHOICES.map((format) => (
                  <label key={format.key} className="flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="radio"
                      name="modal-format"
                      checked={form.modal_format === format.key}
                      onChange={() => set("modal_format", format.key)}
                      className={checkClass}
                    />
                    {format.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <span className={labelClass}>Size</span>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {MODAL_SIZES.map((size) => (
                  <label key={size.key} className="flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="radio"
                      name="modal-size"
                      checked={form.modal_size === size.key}
                      onChange={() => set("modal_size", size.key)}
                      className={checkClass}
                    />
                    {size.label}
                  </label>
                ))}
              </div>
            </div>
            {form.modal_format === "html" ? (
              <HtmlBoxFields
                id="announcement-html"
                html={form.modal_html}
                onHtml={(html) => set("modal_html", html)}
                height={form.modal_height}
                minHeight={L.modalHeightMin}
                maxHeight={L.modalHeightMax}
                onHeight={(n) => set("modal_height", n)}
              />
            ) : (
              <ModalPostEditor
                text={form.modal_text}
                attachment={form.modal_attachment}
                width={MODAL_SIZES.find((size) => size.key === form.modal_size)?.width ?? MODAL_SIZES[2].width}
                onText={(text) => set("modal_text", text)}
                onAttachment={(attachment) => set("modal_attachment", attachment)}
              />
            )}
            <CloseAfter value={form.modal_close_after} onChange={(n) => set("modal_close_after", n)} onPreview={showPreview} />
          </div>
        </Section>
      )}

      {form.show_bar && (
        <Section title="Top bar">
          <div className="flex flex-col gap-3">
            <div>
              <span className={labelClass}>Format</span>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {BAR_FORMAT_CHOICES.map((format) => (
                  <label key={format.key} className="flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="radio"
                      name="bar-format"
                      checked={form.bar_format === format.key}
                      onChange={() => set("bar_format", format.key)}
                      className={checkClass}
                    />
                    {format.label}
                  </label>
                ))}
              </div>
            </div>
            {form.bar_format === "html" ? (
              <HtmlBoxFields
                id="announcement-bar-html"
                html={barCode}
                onHtml={setBarCode}
                height={form.bar_height}
                minHeight={L.barHeightMin}
                maxHeight={L.barHeightMax}
                onHeight={(n) => set("bar_height", n)}
              />
            ) : (
              <AnnouncementTextEditor value={form.bar_html} onChange={(html) => set("bar_html", html)} />
            )}
            <CloseAfter value={form.bar_close_after} onChange={(n) => set("bar_close_after", n)} onPreview={showPreview} />
          </div>
        </Section>
      )}

      <Section title="After a teacher closes it, show it again">
        <p className="mb-3 text-sm text-text-secondary">
          This decides when a teacher sees the announcement again after closing it.
        </p>
        <div className="flex flex-col gap-3">
          {REPEATS.map((repeat) => (
            <label key={repeat} className="flex items-start gap-2 text-sm text-text-primary">
              <input
                type="radio"
                name="repeat"
                checked={form.repeat === repeat}
                onChange={() => set("repeat", repeat)}
                className={`${checkClass} mt-0.5 shrink-0`}
              />
              <span>
                <span className="font-semibold">{REPEAT_LABELS[repeat]}</span>
                <span className="mt-0.5 block text-text-secondary">{REPEAT_HELP[repeat].when}</span>
                <span className="mt-0.5 block text-text-secondary">
                  <span className="font-semibold">Good for:</span> {REPEAT_HELP[repeat].goodFor}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Pages">
        <label className="flex w-fit items-center gap-2 text-sm font-semibold text-text-primary">
          <input
            type="checkbox"
            checked={isAllPages}
            onChange={(e) => set("pages", e.target.checked ? ["all"] : [])}
            className={checkClass}
          />
          All pages
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PAGE_GROUPS.map((group) => (
            <label key={group.key} className={`flex w-fit items-center gap-2 text-sm ${isAllPages ? "text-text-secondary" : "text-text-primary"}`}>
              <input
                type="checkbox"
                disabled={isAllPages}
                checked={isAllPages || form.pages.includes(group.key)}
                onChange={(e) => set("pages", toggleIn(form.pages, group.key, e.target.checked))}
                className={checkClass}
              />
              {group.label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Who sees it">
        <p className="mb-3 text-sm text-text-secondary">
          Empty = everyone. A teacher must fit every filter you fill in; one who hasn&apos;t given that detail doesn&apos;t fit it.
        </p>
        <div className="flex flex-col gap-4">
          <CheckRow
            label="Gender"
            options={GENDERS.map((g) => ({ key: g, label: GENDER_LABELS[g] }))}
            chosen={form.genders}
            onChange={(key, on) => set("genders", toggleIn(form.genders, key, on))}
          />
          <FromTo
            label="Age"
            min={L.ageMin}
            max={L.ageMax}
            from={form.age_min}
            to={form.age_max}
            onFrom={(n) => set("age_min", n)}
            onTo={(n) => set("age_max", n)}
          />
          <CheckRow
            label="Educational background"
            options={EDUCATION_LEVELS.map((level) => ({ key: level, label: EDUCATION_LEVEL_LABELS[level] }))}
            chosen={form.education_levels}
            onChange={(key, on) => set("education_levels", toggleIn(form.education_levels, key, on))}
          />
          <WordsInput
            id="announcement-fields"
            label="Field or major has any of these words"
            value={fieldText}
            onChange={setFieldText}
            placeholder="e.g. English, Filipino"
          />
          <FromTo
            label="Presentations they made"
            min={0}
            max={L.presentationsMax}
            from={form.presentations_min}
            to={form.presentations_max}
            onFrom={(n) => set("presentations_min", n)}
            onTo={(n) => set("presentations_max", n)}
          />
          <CheckRow
            label="Role"
            options={ANNOUNCEMENT_ROLES.map((role) => ({ key: role, label: ROLE_LABELS[role] }))}
            chosen={form.roles}
            onChange={(key, on) => set("roles", toggleIn(form.roles, key, on))}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-input bg-accent-soft px-3 py-2 text-sm text-text-primary">
          <button
            type="button"
            onClick={countTeachers}
            disabled={isCounting}
            className="inline-flex items-center gap-1.5 rounded-dropdown border border-border-default bg-bg-surface px-3 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
          >
            {isCounting && <Spinner size={12} />}
            Count teachers
          </button>
          <span>
            {isCounting ? (
              "Counting… this can take a few seconds."
            ) : !audience ? (
              "See how many accounts these filters match now."
            ) : audience.count === null ? (
              "Can't count yet: check the filters."
            ) : (
              <>
                Matches about <span className="font-semibold">{audience.count.toLocaleString("en-US")}</span>{" "}
                {audience.count === 1 ? "account" : "accounts"} now.
              </>
            )}
          </span>
        </div>
      </Section>

      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={() => save(false)}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-page disabled:opacity-60"
        >
          {isSaving && !savingOn && <Spinner size={14} />}
          Save as draft
        </button>
        <button
          type="button"
          onClick={() => save(true)}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {isSaving && savingOn && <Spinner size={14} />}
          {initial.is_on ? "Save" : "Save and turn on"}
        </button>
      </div>

      {/* Nothing was saved yet: Cancel goes back to the form with the work still in it. */}
      {conflict !== null && (
        <ConfirmModal
          title={`Turn off the current ${typeWord}?`}
          message={`"${conflict}" is the ${typeWord} that's on now. Only one ${typeWord} can be on at a time. Turn it off and turn this one on, or save this one as a draft for later.`}
          confirmLabel="Turn it off and turn this on"
          secondaryLabel="Save as draft"
          onSecondary={() => save(false)}
          onConfirm={() => save(true, true)}
          onCancel={() => setConflict(null)}
        />
      )}

      {preview?.bar && (
        <div className="fixed inset-x-0 top-0 z-[70]">
          <AnnouncementBar
            key={preview.key}
            html={barHtml}
            format={form.bar_format}
            height={form.bar_height}
            closeAfter={form.bar_close_after}
            onClose={() => setPreview((p) => (p && p.modal ? { ...p, bar: false } : null))}
          />
        </div>
      )}
      {preview?.modal && (
        <AnnouncementModal
          key={preview.key}
          text={form.modal_text}
          attachment={form.modal_attachment}
          format={form.modal_format}
          html={form.modal_html}
          height={form.modal_height}
          closeAfter={form.modal_close_after}
          size={form.modal_size}
          onClose={() => setPreview((p) => (p && p.bar ? { ...p, modal: false } : null))}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
      <h2 className="mb-3 text-[15px] font-extrabold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

/** The close delay, with Preview next to it (the section's last row). */
function CloseAfter({ value, onChange, onPreview }: { value: number; onChange: (n: number) => void; onPreview: () => void }) {
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

/** The sealed box's code and height (an HTML modal or top bar). */
function HtmlBoxFields({
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
          Styles and scripts work. It runs in a sealed box: it can&apos;t reach QuizMatter or the teacher&apos;s login,
          and it can&apos;t load anything from other websites. For pictures, copy a link from the Photos tab into
          &lt;img src=&quot;…&quot;&gt;. Links open in a new tab. {html.length}/{L.modalHtml}
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

function CheckRow<T extends string>({
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

function FromTo({
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

function WordsInput({
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
