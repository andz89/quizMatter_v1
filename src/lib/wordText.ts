/**
 * A Word file's text as lines, for the editor's Word file panel (no app imports, so `npm test` loads it).
 * `wordLines` reads `word/document.xml` (unzipped by `wordFile.ts`).
 */

/** The panel lists at most this many lines. */
export const WORD_LINES_MAX = 2000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name] ?? whole;
  });
}

/**
 * One line per paragraph (`<w:p>`), split again at line breaks (`<w:br/>`, `<w:cr/>`). Only `<w:t>` holds text
 * (settings and field codes don't); a tab is a space. A paragraph inside another (a text box) is its own line,
 * listed after the line it sits in. Word writes each text box twice (`mc:Choice` and an older `mc:Fallback`
 * copy): the copy is skipped. Spaces are tidied and empty lines dropped.
 */
export function wordLines(xml: string): string[] {
  const lines: string[] = [];
  // Each open paragraph: the line it's writing (a slot in `lines`, so an outer paragraph keeps its place before
  // a text box's lines).
  const open: number[] = [];
  let inText = 0;
  let inFallback = 0;

  for (const match of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>|([^<]+)/g)) {
    const [, closing, name, selfClosing, text] = match;
    if (text !== undefined) {
      if (inText > 0 && inFallback === 0 && open.length) lines[open[open.length - 1]] += decode(text);
      continue;
    }
    if (name === "mc:Fallback" && !selfClosing) inFallback += closing ? -1 : 1;
    if (inFallback > 0) continue;

    if (name === "w:p" && !selfClosing) {
      if (closing) open.pop();
      else open.push(lines.push("") - 1);
    } else if (name === "w:t" && !selfClosing) {
      inText += closing ? -1 : 1;
    } else if (name === "w:tab" && open.length && !closing) {
      lines[open[open.length - 1]] += " ";
    } else if ((name === "w:br" || name === "w:cr") && open.length && !closing) {
      open[open.length - 1] = lines.push("") - 1;
    }
  }

  return lines.map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * A line without its leading item number or letter ("1.", "12)", "a.", "B)", "(c)", "(3)") and the space after
 * it: the answer boxes already show A–D. Without the space it isn't a mark ("1.5 kg", "2.Dog").
 */
export function stripItemMark(line: string): string {
  return line.replace(/^\s*(?:\(\s*(?:\d{1,3}|[a-zA-Z])\s*\)|(?:\d{1,3}|[a-zA-Z])[.)])\s+/, "").trim();
}

/**
 * A box's new text after a line is dropped on it: the line replaces the text, but the box's first paragraph keeps
 * its settings (alignment, line height), so a centered question stays centered.
 */
export function droppedTextHtml(oldHtml: string | undefined, text: string): string {
  const open = /^<p(?:\s[^>]*)?>/.exec(oldHtml ?? "")?.[0] ?? "<p>";
  return `${open}${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
}

/** At most this many lines are ticked for a new slide: the question and answers A–D. */
export const PICKED_LINES_MAX = 5;

/**
 * Where ticked lines go on a new question slide (and its preview): the first ticked is the question, the next ones
 * answers A–D, in the order they were ticked (`picked` holds line numbers), without their item marks.
 */
export function pickedSlideTexts(lines: string[], picked: number[]): { question: string; options: [string, string, string, string] } {
  const texts = picked.slice(0, PICKED_LINES_MAX).map((i) => stripItemMark(lines[i] ?? ""));
  return { question: texts[0] ?? "", options: [texts[1] ?? "", texts[2] ?? "", texts[3] ?? "", texts[4] ?? ""] };
}
