import {
  CORNER_SIZES,
  DEFAULT_BAR_HEIGHT,
  DEFAULT_MODAL_HEIGHT,
  announcementType,
  type AnnouncementInput,
  type AnnouncementType,
} from "./announcements";

// The admin's announcement form (src/app/admin/announcements/AnnouncementForm.tsx): what a new one starts with, how
// the Type switch changes it, and what a save sends. Plain functions, so they're tested (announcementForm.test.ts).

export const NEW_ANNOUNCEMENT: AnnouncementInput = {
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
  modal_display: "center",
  modal_auto_close: 0,
};

/**
 * The Type switch: a modal, a top bar or a corner box (a modal row shown at the bottom-right). A corner box is Small
 * or Medium (a Large modal becomes Medium). Everything typed stays in the form for a switch back; only the chosen
 * type's fields are saved (toSaved).
 */
export function changeType(form: AnnouncementInput, type: AnnouncementType): AnnouncementInput {
  return {
    ...form,
    show_modal: type !== "bar",
    show_bar: type === "bar",
    modal_display: type === "corner" ? "corner" : "center",
    modal_size: type === "corner" && !CORNER_SIZES.includes(form.modal_size) ? "medium" : form.modal_size,
  };
}

/**
 * What a save sends: the form, with the bar's text or code (`barHtml`: the form keeps the two apart) and the field
 * words (typed as one line). Only the chosen type's and format's fields are kept (the database empties the rest too),
 * and only a corner box closes itself.
 */
export function toSaved(form: AnnouncementInput, barHtml: string, fieldText: string): AnnouncementInput {
  const modalPart =
    form.show_bar ? { modal_text: "", modal_attachment: null, modal_html: "" }
    : form.modal_format === "html" ? { modal_text: "", modal_attachment: null }
    : { modal_html: "" };
  return {
    ...form,
    ...modalPart,
    bar_html: form.show_bar ? barHtml : "",
    field_words: splitWords(fieldText),
    modal_auto_close: announcementType(form) === "corner" ? form.modal_auto_close : 0,
  };
}

// The times are Philippine time (+08:00), whatever the computer's clock says. The box shows "YYYY-MM-DDTHH:mm".
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
export const toTimeInput = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + PH_OFFSET_MS).toISOString().slice(0, 16) : "";
export const fromTimeInput = (value: string) => (value ? new Date(`${value}:00+08:00`).toISOString() : null);

// Word lists are typed as one line, comma separated.
export const splitWords = (text: string) =>
  text
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
