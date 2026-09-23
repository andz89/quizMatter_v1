import { generateHTML, generateJSON } from "@tiptap/core";
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

/**
 * Re-builds saved HTML through the editor's own rules, which drops any tag or style the editor
 * doesn't allow — e.g. a <script> or <img> in the saved data comes out as nothing. Uses the
 * browser's DOM, so call it only on the client.
 */
export function toSafeHtml(html: string): string {
  return generateHTML(generateJSON(html, TEXT_EXTENSIONS), TEXT_EXTENSIONS);
}
