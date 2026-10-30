"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeIcon } from "lucide-react";
import { AnnouncementBar, AnnouncementModal } from "@/components/AnnouncementView";
import { Spinner } from "@/components/Spinner";
import {
  ANNOUNCEMENT_LIMITS as L,
  ANNOUNCEMENT_ROLES,
  MODAL_SIZES,
  PAGE_GROUPS,
  REPEATS,
  REPEAT_LABELS,
  ROLE_LABELS,
  announcementSchema,
  type AnnouncementInput,
} from "@/lib/announcements";
import { PROVINCES } from "@/lib/provinces";
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, GENDERS, GENDER_LABELS } from "@/lib/userSettings";
import { countAudience, saveAnnouncement } from "./actions";
import { AnnouncementTextEditor } from "./AnnouncementTextEditor";

const labelClass = "mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";
const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
const checkClass = "h-4 w-4 accent-accent";

const NEW_ANNOUNCEMENT: AnnouncementInput = {
  id: null,
  name: "",
  is_on: true,
  starts_at: null,
  ends_at: null,
  show_modal: true,
  modal_html: "",
  modal_close_after: 3,
  show_bar: false,
  bar_html: "",
  bar_close_after: 0,
  repeat: "once",
  pages: ["all"],
  genders: [],
  age_min: null,
  age_max: null,
  provinces: [],
  town_words: [],
  education_levels: [],
  field_words: [],
  presentations_min: null,
  presentations_max: null,
  roles: [],
  modal_size: "large",
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
  const [form, setForm] = useState(initial);
  const [townText, setTownText] = useState(initial.town_words.join(", "));
  const [fieldText, setFieldText] = useState(initial.field_words.join(", "));
  const [provinceFilter, setProvinceFilter] = useState("");
  // undefined = counting now; null = couldn't count (e.g. a filter isn't valid yet).
  const [audience, setAudience] = useState<number | null | undefined>(undefined);
  // A new number each time Preview is clicked, so the countdowns start again.
  const [preview, setPreview] = useState<{ key: number; modal: boolean; bar: boolean } | null>(null);
  const [isSaving, startSaving] = useTransition();

  const set = <K extends keyof AnnouncementInput>(key: K, value: AnnouncementInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = <T extends string>(list: T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));
  const input: AnnouncementInput = { ...form, town_words: splitWords(townText), field_words: splitWords(fieldText) };

  // "Matches about N teachers now": asked half a second after the last change to a filter.
  const filters = JSON.stringify({
    genders: input.genders,
    age_min: input.age_min,
    age_max: input.age_max,
    provinces: input.provinces,
    town_words: input.town_words,
    education_levels: input.education_levels,
    field_words: input.field_words,
    presentations_min: input.presentations_min,
    presentations_max: input.presentations_max,
    roles: input.roles,
  });
  useEffect(() => {
    let isCurrent = true;
    const timer = setTimeout(async () => {
      setAudience(undefined);
      const count = await countAudience({ ...NEW_ANNOUNCEMENT, ...JSON.parse(filters) });
      if (isCurrent) setAudience(count);
    }, 500);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [filters]);

  const save = () => {
    // Checked here for a quick message; the server checks again before saving.
    const parsed = announcementSchema.safeParse(input);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    startSaving(async () => {
      const result = await saveAnnouncement(parsed.data);
      if ("error" in result) return void toast.error(result.error);
      toast.success("Announcement saved.");
      router.push("/admin/announcements");
    });
  };

  const showPreview = () => {
    const modal = form.show_modal && form.modal_html !== "";
    const bar = form.show_bar && form.bar_html !== "";
    if (!modal && !bar) return toast.error("Write the modal's or the bar's text first.");
    setPreview({ key: Date.now(), modal, bar });
  };

  const isAllPages = form.pages.includes("all");
  const shownProvinces = PROVINCES.filter((p) => p.toLowerCase().includes(provinceFilter.trim().toLowerCase()));

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
        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={form.is_on} onChange={(e) => set("is_on", e.target.checked)} className={checkClass} />
          On
        </label>
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

      <Section title="Modal">
        <label className="flex w-fit items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={form.show_modal} onChange={(e) => set("show_modal", e.target.checked)} className={checkClass} />
          Show a modal
        </label>
        {form.show_modal && (
          <div className="mt-3 flex flex-col gap-3">
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
            <AnnouncementTextEditor
              part="modal"
              value={form.modal_html}
              width={MODAL_SIZES.find((size) => size.key === form.modal_size)?.width}
              onChange={(html) => set("modal_html", html)}
            />
            <CloseAfter value={form.modal_close_after} onChange={(n) => set("modal_close_after", n)} />
          </div>
        )}
      </Section>

      <Section title="Top bar">
        <label className="flex w-fit items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={form.show_bar} onChange={(e) => set("show_bar", e.target.checked)} className={checkClass} />
          Show a bar at the top (text only)
        </label>
        {form.show_bar && (
          <div className="mt-3 flex flex-col gap-3">
            <AnnouncementTextEditor part="bar" value={form.bar_html} onChange={(html) => set("bar_html", html)} />
            <CloseAfter value={form.bar_close_after} onChange={(n) => set("bar_close_after", n)} />
          </div>
        )}
      </Section>

      <Section title="After a teacher closes it, show it again">
        <div className="flex flex-col gap-2">
          {REPEATS.map((repeat) => (
            <label key={repeat} className="flex w-fit items-center gap-2 text-sm text-text-primary">
              <input type="radio" name="repeat" checked={form.repeat === repeat} onChange={() => set("repeat", repeat)} className={checkClass} />
              {REPEAT_LABELS[repeat]}
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
          <div>
            <span className={labelClass}>
              Provinces{form.provinces.length > 0 && ` (${form.provinces.length} chosen)`}
            </span>
            <input
              value={provinceFilter}
              onChange={(e) => setProvinceFilter(e.target.value)}
              placeholder="Find a province"
              className={`${inputClass} mb-2`}
            />
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-input border border-border-default px-3 py-2 sm:grid-cols-2">
              {shownProvinces.map((province) => (
                <label key={province} className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={form.provinces.includes(province)}
                    onChange={(e) => set("provinces", toggleIn(form.provinces, province, e.target.checked))}
                    className={checkClass}
                  />
                  {province}
                </label>
              ))}
            </div>
          </div>
          <WordsInput
            id="announcement-towns"
            label="City or town has any of these words"
            value={townText}
            onChange={setTownText}
            placeholder="e.g. Mandaue, Lapu-Lapu"
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
        <p className="mt-4 flex items-center gap-2 rounded-input bg-accent-soft px-3 py-2 text-sm text-text-primary">
          {audience === undefined ? (
            <>
              <Spinner size={14} /> Counting…
            </>
          ) : audience === null ? (
            "Can't count yet: check the filters."
          ) : (
            <span>
              Matches about <span className="font-semibold">{audience}</span> {audience === 1 ? "account" : "accounts"} now.
            </span>
          )}
        </p>
      </Section>

      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={showPreview}
          className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-page"
        >
          <EyeIcon size={16} />
          Preview
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {isSaving && <Spinner size={14} />}
          Save
        </button>
      </div>

      {preview?.bar && (
        <div className="fixed inset-x-0 top-0 z-[70]">
          <AnnouncementBar
            key={preview.key}
            html={form.bar_html}
            closeAfter={form.bar_close_after}
            onClose={() => setPreview((p) => (p && p.modal ? { ...p, bar: false } : null))}
          />
        </div>
      )}
      {preview?.modal && (
        <AnnouncementModal
          key={preview.key}
          html={form.modal_html}
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

function CloseAfter({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
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
