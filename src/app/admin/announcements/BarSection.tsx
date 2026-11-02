"use client";

import { ANNOUNCEMENT_LIMITS as L, type AnnouncementInput } from "@/lib/announcements";
import { AnnouncementTextEditor } from "./AnnouncementTextEditor";
import { CloseAfter, HtmlBoxFields, Section, checkClass, labelClass, type SetField } from "./formParts";

// The Format choices: a text bar (the editor's cleaned HTML), or the admin's HTML in a sealed box.
const BAR_FORMAT_CHOICES = [
  { key: "text", label: "Text" },
  { key: "html", label: "HTML (sealed box)" },
] as const;

/**
 * The form's Top bar section: Format, the text editor (`form.bar_html`) or the sealed box's code (`barCode`; the form
 * keeps the two apart, so switching format loses neither), and the close delay with Preview.
 */
export function BarSection({
  form,
  set,
  barCode,
  onBarCode,
  onPreview,
}: {
  form: AnnouncementInput;
  set: SetField;
  barCode: string;
  onBarCode: (html: string) => void;
  onPreview: () => void;
}) {
  return (
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
            onHtml={onBarCode}
            height={form.bar_height}
            minHeight={L.barHeightMin}
            maxHeight={L.barHeightMax}
            onHeight={(n) => set("bar_height", n)}
          />
        ) : (
          <AnnouncementTextEditor value={form.bar_html} onChange={(html) => set("bar_html", html)} />
        )}
        <CloseAfter value={form.bar_close_after} onChange={(n) => set("bar_close_after", n)} onPreview={onPreview} />
      </div>
    </Section>
  );
}
