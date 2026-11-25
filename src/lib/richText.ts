import { createDocument, getHTMLFromFragment, getSchema, type Editor, type JSONContent } from "@tiptap/core";
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

/** Turns saved plain text (presentations made before styled text existed) into editor HTML, one paragraph per line. */
export function textToHtml(text: string): string {
  if (text === "") return "";
  const escape = (line: string) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return tidyText(text)
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

/** The words of `markupToHtml`'s text without the ** and * marks, tidied like its HTML (`tidyText`). */
export function stripMarkup(text: string): string {
  return tidyText(text).replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
}

/**
 * Text from outside (Claude's import, plain text saved before styled text): a Windows line end ("\r\n" or "\r") is a
 * new line and a tab is one space. Saved text is read back keeping its spaces, so they would show as a space at the
 * line's end or a wide gap.
 */
function tidyText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replaceAll("\t", " ");
}

/**
 * Saved HTML before it is read: the editor never writes a tab or line end into it (`getHTML`), but older Claude
 * imports did ("<p>One\r</p>", "<p>Answer:\tParis</p>"). A line end at a tag's edge goes; one inside the text, and
 * a tab, become one space, as they showed before saved text kept its spaces.
 */
export function tidySavedHtml(html: string): string {
  return html.replace(/[\r\n]+(?=<)|(?<=>)[\r\n]+/g, "").replace(/[\r\n\t]+/g, " ");
}

// Keep the spaces a teacher typed. Left out, reading HTML squeezes each run of spaces into one and drops spaces at a
// line's start, so "Name:     Score:" came back as "Name: Score:" after saving and opening again.
const TEXT_PARSE_OPTIONS = { preserveWhitespace: true } as const;

// Built once: `toSafeHtml` runs for every text on every slide and thumbnail.
const TEXT_SCHEMA = getSchema(TEXT_EXTENSIONS);

/**
 * Saved text HTML as the editor's document, keeping typed spaces. The editor loads it as this document, never as HTML
 * with an editor-wide `parseOptions` (that would also change every later `insertContent`). Browser only.
 */
export function readSavedText(html: string): JSONContent {
  return createDocument(tidySavedHtml(html), TEXT_SCHEMA, TEXT_PARSE_OPTIONS).toJSON();
}

/**
 * Re-builds saved HTML through the editor's own rules, which drops any tag or style the editor
 * doesn't allow — e.g. a <script> or <img> in the saved data comes out as nothing. Keeps typed spaces. Uses the
 * browser's DOM, so call it only on the client.
 */
export function toSafeHtml(html: string): string {
  return getHTMLFromFragment(createDocument(tidySavedHtml(html), TEXT_SCHEMA, TEXT_PARSE_OPTIONS).content, TEXT_SCHEMA);
}
