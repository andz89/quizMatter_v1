"use client";

import {
  ANNOUNCEMENT_LIMITS as L,
  CORNER_SIZES,
  MODAL_SIZES,
  announcementType,
  type AnnouncementInput,
} from "@/lib/announcements";
import { AutoClose, CloseAfter, HtmlBoxFields, Section, ShowAfter, checkClass, labelClass, type SetField } from "./formParts";
import { ModalPostEditor } from "./ModalPostEditor";

// The Format choices: a post (text + one picture, video or post), or the admin's HTML in a sealed box.
const MODAL_FORMAT_CHOICES = [
  { key: "post", label: "Post (text + picture or video)" },
  { key: "html", label: "HTML (sealed box)" },
] as const;

/**
 * The form's Modal section, titled "Corner box" for a corner box (the same fields, Small / Medium only, plus "Closes
 * itself"): Format, Size, the post editor or the sealed box's code, when it shows, and the close delay with Preview.
 */
export function ModalSection({ form, set, onPreview }: { form: AnnouncementInput; set: SetField; onPreview: () => void }) {
  const type = announcementType(form);
  return (
    <Section title={type === "corner" ? "Corner box" : "Modal"}>
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
            {MODAL_SIZES.filter((size) => type !== "corner" || CORNER_SIZES.includes(size.key)).map((size) => (
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
        <ShowAfter value={form.modal_show_after} onChange={(n) => set("modal_show_after", n)} />
        {type === "corner" && <AutoClose value={form.modal_auto_close} onChange={(n) => set("modal_auto_close", n)} />}
        <CloseAfter value={form.modal_close_after} onChange={(n) => set("modal_close_after", n)} onPreview={onPreview} />
      </div>
    </Section>
  );
}
