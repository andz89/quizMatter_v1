"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnnouncementBar, AnnouncementCornerBox, AnnouncementModal } from "@/components/AnnouncementView";
import { Spinner } from "@/components/Spinner";
import { ConfirmModal } from "@/components/editor/ConfirmModal";
import { NEW_ANNOUNCEMENT, changeType, fromTimeInput, toSaved, toTimeInput } from "@/lib/announcementForm";
import {
  ANNOUNCEMENT_LIMITS as L,
  PAGE_GROUPS,
  TYPE_WORDS,
  announcementSchema,
  announcementType,
  type AnnouncementInput,
  type AnnouncementType,
} from "@/lib/announcements";
import { saveAnnouncement } from "./actions";
import { AudienceSection } from "./AudienceSection";
import { BarSection } from "./BarSection";
import { Section, checkClass, inputClass, labelClass, toggleIn, type SetField } from "./formParts";
import { ModalSection } from "./ModalSection";
import { RepeatSection } from "./RepeatSection";

// The Type choice: an announcement is a modal, a top bar or a corner box (a modal row shown at the bottom-right,
// modal_display "corner"), never two.
const TYPES = [
  { key: "modal", label: "Modal" },
  { key: "bar", label: "Top bar (text only)" },
  { key: "corner", label: "Corner box" },
] satisfies { key: AnnouncementType; label: string }[];

/**
 * The new / edit form: what it says, when and where it shows, and who sees it. It keeps all the data; its sections
 * (ModalSection, BarSection, RepeatSection, AudienceSection) only draw it. Saves through saveAnnouncement what toSaved
 * gives (src/lib/announcementForm.ts).
 */
export function AnnouncementForm({ initial = NEW_ANNOUNCEMENT }: { initial?: AnnouncementInput }) {
  const router = useRouter();
  // bar_html holds the text bar's editor HTML or the html bar's code, by bar_format. The form keeps them apart
  // (form.bar_html for the text editor, barCode for the code box), so switching format loses neither.
  const [form, setForm] = useState(initial.bar_format === "html" ? { ...initial, bar_html: "" } : initial);
  const [barCode, setBarCode] = useState(initial.bar_format === "html" ? initial.bar_html : "");
  const barHtml = form.bar_format === "html" ? barCode : form.bar_html;
  const [fieldText, setFieldText] = useState(initial.field_words.join(", "));
  // A new number each time Preview is clicked, so the countdowns start again.
  const [preview, setPreview] = useState<{ key: number; modal: boolean; bar: boolean } | null>(null);
  const [isSaving, startSaving] = useTransition();
  // Which button is saving (true = turn on), for its spinner.
  const [savingOn, setSavingOn] = useState(false);
  // The name of the one of the same type that is on, when Save and turn on was refused for it (the box asks).
  const [conflict, setConflict] = useState<string | null>(null);
  const type = announcementType(form);
  const typeWord = TYPE_WORDS[type];

  const set: SetField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // turnOn false = Save as draft. replaceCurrent: turn off the one of the same type that is on (after the box asked).
  const save = (turnOn: boolean, replaceCurrent = false) => {
    setConflict(null);
    // Checked here for a quick message; the server checks again before saving.
    const parsed = announcementSchema.safeParse({ ...toSaved(form, barHtml, fieldText), is_on: turnOn });
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
    if (!modal && !bar) return toast.error(`Write the ${typeWord} first.`);
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
          {TYPES.map((choice) => (
            <label key={choice.key} className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="radio"
                name="announcement-type"
                checked={type === choice.key}
                onChange={() => setForm((f) => changeType(f, choice.key))}
                className={checkClass}
              />
              {choice.label}
            </label>
          ))}
        </div>
      </Section>

      {form.show_modal && <ModalSection form={form} set={set} onPreview={showPreview} />}

      {form.show_bar && (
        <BarSection form={form} set={set} barCode={barCode} onBarCode={setBarCode} onPreview={showPreview} />
      )}

      <RepeatSection value={form.repeat} onChange={(repeat) => set("repeat", repeat)} />

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

      <AudienceSection form={form} set={set} fieldText={fieldText} onFieldText={setFieldText} />

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
      {/* A corner box previews as the real box: the admin page stays usable, as it does for teachers. */}
      {preview?.modal && type === "corner" && (
        <AnnouncementCornerBox
          key={preview.key}
          text={form.modal_text}
          attachment={form.modal_attachment}
          format={form.modal_format}
          html={form.modal_html}
          height={form.modal_height}
          closeAfter={form.modal_close_after}
          autoClose={form.modal_auto_close}
          size={form.modal_size}
          onClose={() => setPreview((p) => (p && p.bar ? { ...p, modal: false } : null))}
        />
      )}
      {preview?.modal && type !== "corner" && (
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
