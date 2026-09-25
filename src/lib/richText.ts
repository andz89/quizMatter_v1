import { generateHTML, generateJSON, type Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, Color } from "@tiptap/extension-text-style";

/** Everything a question/option box can hold: paragraphs with bold, italic, underline, color and alignment. */
export const TEXT_EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  HardBreak,
  Bold,
  Italic,
  Underline,
  TextStyle,
  Color,
  TextAlign.configure({ types: ["paragraph"] }),
];

/**
 * Where a format button (bold, align, color…) applies: the selected words while typing, or all the
 * text when the box is only selected (one click, not typing).
 */
export function formatChain(editor: Editor) {
  return editor.isEditable ? editor.chain().focus() : editor.chain().selectAll();
}

/** Text color when none is set — matches --text-primary. */
export const DEFAULT_TEXT_COLOR = "#1F1F1F";

/** Turns saved plain text (quizzes made before styled text existed) into editor HTML, one paragraph per line. */
export function textToHtml(text: string): string {
  if (text === "") return "";
  const escape = (line: string) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split("\n")
    .map((line) => `<p>${escape(line)}</p>`)
    .join("");
}

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
}

/**
 * Turns plain text with simple marks (e.g. written by Claude) into editor HTML: **bold** and *italic*
 * words, plus one style for the whole text. The text is escaped first, so it can't carry its own HTML.
 */
export function markupToHtml(text: string, { bold, italic, underline, color, align }: TextStyle = {}): string {
  const inline = (html: string) =>
    html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  const pOpen = align && align !== "left" ? `<p style="text-align: ${align}">` : "<p>";
  return textToHtml(text)
    .split("</p>")
    .filter(Boolean)
    .map((p) => {
      let html = inline(p.slice("<p>".length));
      if (color) html = `<span style="color: ${color}">${html}</span>`;
      if (underline) html = `<u>${html}</u>`;
      if (italic) html = `<em>${html}</em>`;
      if (bold) html = `<strong>${html}</strong>`;
      return `${pOpen}${html}</p>`;
    })
    .join("");
}

/** The words of `markupToHtml`'s text without the ** and * marks. */
export function stripMarkup(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
}

/**
 * Re-builds saved HTML through the editor's own rules, which drops any tag or style the editor
 * doesn't allow — e.g. a <script> or <img> in the saved data comes out as nothing. Uses the
 * browser's DOM, so call it only on the client.
 */
export function toSafeHtml(html: string): string {
  return generateHTML(generateJSON(html, TEXT_EXTENSIONS), TEXT_EXTENSIONS);
}
