import { generateHTML, generateJSON, type JSONContent } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { TEXT_EXTENSIONS } from "./richText";
import { PHOTO_URL_PREFIX } from "./constants";
import type { AnnouncementPart } from "./announcements";

// The text of an announcement (see announcements.ts): what its editor allows, and how saved text is made safe.

/** The modal's text: the slide text styles plus links and our own photos. */
export const ANNOUNCEMENT_MODAL_EXTENSIONS = [
  ...TEXT_EXTENSIONS,
  Link.configure({ openOnClick: false, autolink: false }),
  Image.configure({ inline: false, allowBase64: false }),
];

/** The bar's text: the same, without images. */
export const ANNOUNCEMENT_BAR_EXTENSIONS = [...TEXT_EXTENSIONS, Link.configure({ openOnClick: false, autolink: false })];

/** A path inside QuizMatter ("/saved"), not another site ("//x.com", "https://…"). */
export function isInternalLink(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/** Links an announcement may hold: http(s) addresses and paths inside the app. */
export function isAllowedLink(href: string): boolean {
  return /^https?:\/\//i.test(href) || isInternalLink(href);
}

/** Drops images that aren't our R2 photos, and links that aren't allowed (their text stays). */
export function cleanAnnouncementDoc(doc: JSONContent): JSONContent {
  const content = doc.content
    ?.filter((node) => node.type !== "image" || String(node.attrs?.src ?? "").startsWith(PHOTO_URL_PREFIX))
    .map(cleanAnnouncementDoc);
  const marks = doc.marks?.filter((mark) => mark.type !== "link" || isAllowedLink(String(mark.attrs?.href ?? "")));
  return { ...doc, ...(content && { content }), ...(marks && { marks }) };
}

/**
 * Re-builds saved announcement text through the editor's rules (like toSafeHtml in richText.ts): tags, styles and
 * attributes the extensions don't know are dropped, then cleanAnnouncementDoc removes unsafe links and images.
 * Uses the browser's DOM, so call it only on the client.
 */
export function toSafeAnnouncementHtml(html: string, part: AnnouncementPart): string {
  const extensions = part === "modal" ? ANNOUNCEMENT_MODAL_EXTENSIONS : ANNOUNCEMENT_BAR_EXTENSIONS;
  return generateHTML(cleanAnnouncementDoc(generateJSON(html, extensions)), extensions);
}
