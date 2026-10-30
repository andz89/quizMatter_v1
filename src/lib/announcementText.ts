import { generateHTML, generateJSON, type JSONContent } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { TEXT_EXTENSIONS } from "./richText";
import { PHOTO_URL_PREFIX } from "./constants";
import type { AnnouncementPart } from "./announcements";

// The text of an announcement (see announcements.ts): what its editor allows, and how saved text is made safe.

/**
 * Tiptap's resizable image shows a new size only while it's dragged: it never puts the saved width on the picture
 * in the editor (when an announcement opens again, or after "Full width"). This does, after every change; the
 * height follows the shape (h-auto).
 */
const SizedImage = Image.extend({
  addNodeView() {
    const makeView = this.parent?.();
    if (!makeView) return null;
    return (props) => {
      const view = makeView(props) as NodeView;
      const img = view.dom instanceof HTMLElement ? view.dom.querySelector("img") : null;
      const showSize = (node: ProseMirrorNode) => {
        if (!img) return;
        img.style.width = node.attrs.width ? `${node.attrs.width}px` : "";
        img.style.height = "";
      };
      showSize(props.node);
      const update = view.update?.bind(view);
      if (update) {
        view.update = (node, decorations, innerDecorations) => {
          const kept = update(node, decorations, innerDecorations);
          if (kept) showSize(node);
          return kept;
        };
      }
      return view;
    };
  },
});

/**
 * The modal's text: the slide text styles plus links and our own photos. A photo is always centered, on its own
 * line; its corner handles resize it (shape kept), saved as its width and height.
 */
export const ANNOUNCEMENT_MODAL_EXTENSIONS = [
  ...TEXT_EXTENSIONS,
  Link.configure({ openOnClick: false, autolink: false }),
  SizedImage.configure({
    inline: false,
    allowBase64: false,
    resize: {
      enabled: true,
      directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
      minWidth: 40,
      minHeight: 40,
      alwaysPreserveAspectRatio: true,
    },
  }),
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
