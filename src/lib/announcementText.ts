import { generateHTML, generateJSON, type JSONContent } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { isAllowedLink } from "./announcements";
import { TEXT_EXTENSIONS } from "./richText";

// The top bar's text (see announcements.ts; the modal is plain text, shown with LinkifiedText): what its editor
// allows, and how saved text is made safe. Heavy (Tiptap), so teachers' pages load it only when a bar shows.

/** The bar's text: the slide text styles (bold, italic, underline, color, align) plus links. */
export const ANNOUNCEMENT_BAR_EXTENSIONS = [...TEXT_EXTENSIONS, Link.configure({ openOnClick: false, autolink: false })];

/** Drops links that aren't allowed (their text stays). */
export function cleanAnnouncementDoc(doc: JSONContent): JSONContent {
  const content = doc.content?.map(cleanAnnouncementDoc);
  const marks = doc.marks?.filter((mark) => mark.type !== "link" || isAllowedLink(String(mark.attrs?.href ?? "")));
  return { ...doc, ...(content && { content }), ...(marks && { marks }) };
}

/**
 * Re-builds the bar's saved text through its editor's rules (like toSafeHtml in richText.ts): tags, styles and
 * attributes the extensions don't know are dropped (pictures and scripts too), then cleanAnnouncementDoc removes
 * unsafe links. Uses the browser's DOM, so call it only on the client.
 */
export function toSafeAnnouncementHtml(html: string): string {
  return generateHTML(cleanAnnouncementDoc(generateJSON(html, ANNOUNCEMENT_BAR_EXTENSIONS)), ANNOUNCEMENT_BAR_EXTENSIONS);
}
