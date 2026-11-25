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

// Small raised / lowered characters for equations (x², H₂O); anything else is written ^(…) / _(…).
const RAISED: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};
const LOWERED: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", n: "ₙ", i: "ᵢ",
};

// The Symbol font's letters and signs (Word's Insert → Symbol), by their place in the font.
const SYMBOL_FONT: Record<string, string> = {
  a: "α", b: "β", g: "γ", d: "δ", e: "ε", z: "ζ", h: "η", q: "θ", i: "ι", k: "κ", l: "λ", m: "μ", n: "ν", x: "ξ",
  o: "ο", p: "π", r: "ρ", s: "σ", t: "τ", u: "υ", f: "φ", c: "χ", y: "ψ", w: "ω",
  G: "Γ", D: "Δ", Q: "Θ", L: "Λ", X: "Ξ", P: "Π", S: "Σ", F: "Φ", Y: "Ψ", W: "Ω",
  "´": "×", "¸": "÷", "±": "±", "£": "≤", "³": "≥", "¹": "≠", "Ö": "√", "¥": "∞",
  "°": "°", "®": "→", "¬": "←", "»": "≈", "·": "•", "×": "·", "¢": "′", "²": "″",
};

/** Text that needs brackets to stay one piece next to ^, _, / or √ ("x+1" → "(x+1)"). */
const group = (text: string) => (text.length <= 1 || /^[\p{L}\p{N}.]+$/u.test(text) ? text : `(${text})`);
/** Raised (x²) or lowered (H₂O) text: small characters when each has one, else "^(ab)" / "_(ab)". */
const shift = (text: string, map: Record<string, string>, mark: string) =>
  !text
    ? ""
    : [...text].every((c) => map[c])
      ? [...text].map((c) => map[c]).join("")
      : `${mark}${[...text].length > 1 ? `(${text})` : text}`;

/** A character from Word's Insert → Symbol (`<w:sym>`): the Symbol font's Greek letters and signs, plain
 * characters from normal fonts, nothing for picture fonts (Wingdings…), whose characters mean nothing as text. */
function symbolText(font: string, hex: string): string {
  const code = parseInt(hex, 16);
  if (!Number.isFinite(code)) return "";
  const low = String.fromCharCode(code & 0xff);
  if (/^symbol$/i.test(font)) return SYMBOL_FONT[low] ?? "";
  if (/wingdings|webdings|dingbat/i.test(font) || (code >= 0xf000 && code <= 0xf0ff)) return "";
  return String.fromCodePoint(code);
}

const attr = (tag: string, name: string) => {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  return value === undefined ? undefined : decode(value);
};

// The equation parts whose text is gathered first, then written as one (x², 1/2, √9, (a), ∑…).
const MATH_PARTS = new Set(["m:sup", "m:sub", "m:num", "m:den", "m:deg", "m:rad", "m:d", "m:nary"]);
type MathPart = { name: string; text: string; deg?: string; begin?: string; end?: string; sign?: string };

function writeMathPart(part: MathPart, parent: MathPart | undefined): string {
  switch (part.name) {
    case "m:sup": return shift(part.text, RAISED, "^");
    case "m:sub": return shift(part.text, LOWERED, "_");
    case "m:num": return `${group(part.text)}/`;
    case "m:den": return group(part.text);
    case "m:deg":
      if (parent?.name === "m:rad") parent.deg = part.text;
      return "";
    case "m:rad": return `${part.deg ? shift(part.deg, RAISED, "^") : ""}√${group(part.text)}`;
    case "m:d": return `${part.begin ?? "("}${part.text}${part.end ?? ")"}`;
    default: return `${part.sign ?? "∫"}${part.text}`; // m:nary: a sum, product or integral
  }
}

/** One level of a Word list: its number style (`decimal`, `lowerLetter`, `bullet`…), its text ("%1.", "(%1)",
 * "%1.%2.") and the number it starts at. */
type ListLevel = { format: string; text: string; start: number };

/** Word's lists (`word/numbering.xml`): each list (`numId`), its levels by depth (`ilvl`) and the counter it
 * counts on (`counter`). */
export type Numbering = Map<string, { levels: ListLevel[]; counter: string }>;

/**
 * Reads `word/numbering.xml`: each `w:num` (a list a paragraph points to) gets the levels of its `w:abstractNum`,
 * with a `w:startOverride` (Word's "Restart numbering") applied. Lists made from the same `w:abstractNum` share one
 * counter, like Word (questions pasted in from another file often get their own `w:num` but keep counting); one
 * with a restart counts on its own.
 */
export function parseNumbering(xml: string): Numbering {
  const abstract = new Map<string, ListLevel[]>();
  const lists: { id: string; abstractId: string; starts: Map<number, number> }[] = [];
  let abstractLevels: ListLevel[] | null = null;
  let level: ListLevel | null = null;
  let list: (typeof lists)[number] | null = null;
  let overrideLevel = -1;

  for (const [tag, closing, name] of xml.matchAll(/<(\/?)([\w:]+)[^>]*>/g)) {
    if (closing) {
      if (name === "w:abstractNum") abstractLevels = null;
      else if (name === "w:lvl") level = null;
      else if (name === "w:num") list = null;
      continue;
    }
    if (name === "w:abstractNum") {
      abstractLevels = [];
      abstract.set(attr(tag, "w:abstractNumId") ?? "", abstractLevels);
    } else if (name === "w:lvl" && abstractLevels) {
      level = { format: "decimal", text: "", start: 1 };
      abstractLevels[Number(attr(tag, "w:ilvl") ?? 0)] = level;
    } else if (level && name === "w:start") {
      level.start = Number(attr(tag, "w:val") ?? 1) || 0;
    } else if (level && name === "w:numFmt") {
      level.format = attr(tag, "w:val") ?? "decimal";
    } else if (level && name === "w:lvlText") {
      level.text = attr(tag, "w:val") ?? "";
    } else if (name === "w:num") {
      list = { id: attr(tag, "w:numId") ?? "", abstractId: "", starts: new Map() };
      lists.push(list);
    } else if (list && name === "w:abstractNumId") {
      list.abstractId = attr(tag, "w:val") ?? "";
    } else if (list && name === "w:lvlOverride") {
      overrideLevel = Number(attr(tag, "w:ilvl") ?? -1);
    } else if (list && name === "w:startOverride") {
      list.starts.set(overrideLevel, Number(attr(tag, "w:val") ?? 1) || 0);
    }
  }

  const numbering: Numbering = new Map();
  for (const { id, abstractId, starts } of lists) {
    const levels = abstract.get(abstractId);
    if (!levels) continue;
    numbering.set(id, {
      levels: levels.map((l, i) => (l && starts.has(i) ? { ...l, start: starts.get(i)! } : l)),
      counter: starts.size ? `num:${id}` : `abstract:${abstractId}`,
    });
  }
  return numbering;
}

/** A paragraph style's list (`numId`) and depth, from `word/styles.xml`. */
export type StyleNumbers = Map<string, { numId: string; depth: number }>;

/**
 * Reads `word/styles.xml`: the paragraph styles that number their paragraphs (Word's "List Number", a custom
 * "Question" style), following `w:basedOn` to the style that holds the `w:numPr`.
 */
export function parseStyleNumbers(xml: string): StyleNumbers {
  const styles = new Map<string, { basedOn?: string; numId?: string; depth?: number }>();
  let style: { basedOn?: string; numId?: string; depth?: number } | null = null;
  for (const [tag, closing, name] of xml.matchAll(/<(\/?)([\w:]+)[^>]*>/g)) {
    if (name === "w:style") {
      style = closing ? null : {};
      if (style) styles.set(attr(tag, "w:styleId") ?? "", style);
    } else if (!style || closing) {
      continue;
    } else if (name === "w:basedOn") {
      style.basedOn = attr(tag, "w:val");
    } else if (name === "w:numId") {
      style.numId = attr(tag, "w:val");
    } else if (name === "w:ilvl") {
      style.depth = Number(attr(tag, "w:val") ?? 0) || 0;
    }
  }
  const found: StyleNumbers = new Map();
  for (const id of styles.keys()) {
    let numId: string | undefined;
    let depth: number | undefined;
    // At most 10 steps up the basedOn chain, so a loop in a broken file ends.
    for (let s = styles.get(id), steps = 0; s && steps < 10; s = s.basedOn ? styles.get(s.basedOn) : undefined, steps++) {
      numId ??= s.numId;
      depth ??= s.depth;
    }
    if (numId && numId !== "0") found.set(id, { numId, depth: depth ?? 0 });
  }
  return found;
}

const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

/** A list number in its style: 3 → "3", "03", "c", "C", "iii", "III"; 27 → "aa" (Word repeats the letter). A
 * letter list's 0 is "0". */
function formatNumber(n: number, format: string): string {
  if (format === "decimalZero") return n >= 0 && n < 10 ? `0${n}` : String(n);
  if ((format === "lowerLetter" || format === "upperLetter") && n > 0) {
    const letter = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
    return format === "upperLetter" ? letter.toUpperCase() : letter;
  }
  if ((format === "lowerRoman" || format === "upperRoman") && n > 0 && n < 4000) {
    let rest = n;
    let roman = "";
    for (const [value, digits] of ROMAN) for (; rest >= value; rest -= value) roman += digits;
    return format === "upperRoman" ? roman.toUpperCase() : roman;
  }
  return String(n);
}

/**
 * Counts Word's list numbers as the document goes, like Word: each counter (`parseNumbering`) keeps a count per
 * depth, and a new item at one depth starts the deeper ones over ("1." then "a)", "b)", then "2." then "a)"
 * again). Bullets and "none" give no text. Returns the number's text ("1.", "a)", "(I)") or "".
 */
function listCounter(numbering: Numbering | undefined) {
  const counts = new Map<string, number[]>();
  return (numId: string, depth: number): string => {
    const list = numbering?.get(numId);
    const levels = list?.levels;
    const level = levels?.[depth];
    if (!list || !levels || !level) return "";
    const count = counts.get(list.counter) ?? [];
    count[depth] = count[depth] === undefined ? level.start : count[depth] + 1;
    count.length = depth + 1;
    counts.set(list.counter, count);
    if (level.format === "bullet" || level.format === "none") return "";
    return level.text.replace(/%(\d)/g, (_, k: string) => {
      const i = Number(k) - 1;
      return formatNumber(count[i] ?? levels[i]?.start ?? 1, levels[i]?.format ?? "decimal");
    });
  };
}

/**
 * One line per paragraph (`<w:p>`), split again at line breaks (`<w:br/>`, `<w:cr/>`). Only `<w:t>` (and an
 * equation's `<m:t>`) holds text (settings and field codes don't); a tab before a choice's letter starts a new line
 * (two choices side by side, `splitChoices`), any other tab is a space, a non-breaking hyphen a "-",
 * a `<w:sym>` its character (`symbolText`). Equations become plain text: x², H₂O, x^(ab), (x+1)/2, ³√8, [a], ∑ᵢ₌₁ⁿi.
 * With `numbering` (`parseNumbering`), Word's automatic list numbers ("1.", "a)") are written in front of the text,
 * since Word keeps them out of it; a paragraph style that numbers (`styleNumbers`, `parseStyleNumbers`) counts as
 * the paragraph's own list unless the paragraph names one. Text moved with Track Changes on is read once, at its
 * new place (`w:moveFrom`, the old copy, is skipped; deleted text is `w:delText`, never read). A paragraph inside another (a text box) is its own line, listed after the line it sits in. Word writes each text
 * box twice (`mc:Choice` and an older `mc:Fallback` copy): the copy is skipped. Spaces are tidied and empty lines
 * dropped.
 */
export function wordLines(xml: string, numbering?: Numbering, styleNumbers?: StyleNumbers): string[] {
  const lines: string[] = [];
  // Each open paragraph: the line it's writing (a slot in `lines`, so an outer paragraph keeps its place before
  // a text box's lines).
  const open: number[] = [];
  // Equation parts being gathered, innermost last.
  const parts: MathPart[] = [];
  let inText = 0;
  let inFallback = 0;
  // Word's list number of the paragraph being read (its list and depth, from <w:numPr>), written in front of its
  // text when its settings (<w:pPr>) end. A tracked change's old settings (<w:pPrChange>) are skipped.
  const listNumber = listCounter(numbering);
  // numId / depth undefined = not named by the paragraph (its style's are used).
  let list: { style: string; numId?: string; depth?: number } = { style: "" };
  let inOldSettings = 0;
  let inMovedFrom = 0;
  // Inside an n-ary's settings (<m:naryPr>), where its sign (<m:chr>) is; an accent's <m:chr> further in isn't it.
  let inNarySettings = false;

  const add = (text: string) => {
    if (parts.length) parts[parts.length - 1].text += text;
    else if (open.length) lines[open[open.length - 1]] += text;
  };

  for (const match of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>|([^<]+)/g)) {
    const [tag, closing, name, selfClosing, text] = match;
    if (text !== undefined) {
      if (inText > 0 && inFallback === 0) add(decode(text));
      continue;
    }
    if (name === "mc:Fallback" && !selfClosing) inFallback += closing ? -1 : 1;
    if (inFallback > 0) continue;
    if (name === "w:pPrChange" && !selfClosing) inOldSettings += closing ? -1 : 1;
    if (inOldSettings > 0) continue;
    if (name === "w:moveFrom" && !selfClosing) inMovedFrom += closing ? -1 : 1;
    if (inMovedFrom > 0) continue;
    if (name === "m:naryPr" && !selfClosing) inNarySettings = !closing;
    const top = parts[parts.length - 1];

    if (MATH_PARTS.has(name) && !selfClosing) {
      if (!closing) parts.push({ name, text: "" });
      else if (top?.name === name) {
        parts.pop();
        add(writeMathPart(top, parts[parts.length - 1]));
      }
    } else if (name === "w:p" && !selfClosing) {
      if (closing) open.pop();
      else open.push(lines.push("") - 1);
      list = { style: "" };
    } else if (name === "w:pPr" && closing) {
      const fromStyle = styleNumbers?.get(list.style);
      const numId = list.numId ?? fromStyle?.numId;
      const depth = list.depth ?? (list.numId === undefined ? fromStyle?.depth : undefined) ?? 0;
      const number = numId && numId !== "0" ? listNumber(numId, depth) : "";
      if (number) add(`${number} `);
    } else if ((name === "w:t" || name === "m:t") && !selfClosing) {
      inText += closing ? -1 : 1;
    } else if (closing) {
      continue;
    } else if (name === "w:tab") {
      add("\t");
    } else if (name === "w:pStyle") {
      list.style = attr(tag, "w:val") ?? "";
    } else if (name === "w:numId") {
      list.numId = attr(tag, "w:val") ?? "";
    } else if (name === "w:ilvl") {
      list.depth = Number(attr(tag, "w:val") ?? 0) || 0;
    } else if (name === "w:noBreakHyphen") {
      add("-");
    } else if (name === "w:sym") {
      add(symbolText(attr(tag, "w:font") ?? "", attr(tag, "w:char") ?? ""));
    } else if ((name === "m:begChr" || name === "m:endChr") && top?.name === "m:d") {
      top[name === "m:begChr" ? "begin" : "end"] = attr(tag, "m:val") ?? "";
    } else if (name === "m:chr" && inNarySettings && top?.name === "m:nary") {
      top.sign = attr(tag, "m:val") ?? "";
    } else if ((name === "w:br" || name === "w:cr") && open.length && !parts.length) {
      open[open.length - 1] = lines.push("") - 1;
    }
  }

  return lines
    .flatMap(splitChoices)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * A line without its leading item number, letter or Roman numeral ("1.", "12)", "a.", "B)", "(c)", "(3)", "II.",
 * "iv)") and the space after it: the answer boxes already show A–D. Without the space it isn't a mark ("1.5 kg",
 * "2.Dog"); "Mr." isn't a Roman numeral. A blank for the answer in front of the mark ("____ 1.") goes too; a blank
 * with no mark after it is part of the text ("____ is the capital").
 * A single letter could be a name's initial, so it goes only when it's a choice's letter (A–E) in an answer box, or
 * a Roman one (I, V, X) in the question box, and never right before another initial ("J. K. Rowling"). So the
 * question box keeps "A. Lincoln signed…" whole.
 */
export function stripItemMark(line: string, box: "question" | "option" = "option"): string {
  const letter = box === "option" ? "[A-Ea-e]" : "[IVXivx]";
  const mark = `(?:\\d{1,3}|${letter}|[ivxlc]{2,6}|[IVXLC]{2,6})`;
  const found = new RegExp(`^\\s*(?:_{2,}\\s*)?(?:\\(\\s*(${mark})\\s*\\)|(${mark})[.)])\\s+`).exec(line);
  if (!found) return line.trim();
  const rest = line.slice(found[0].length);
  const isInitial = /^[A-Za-z]$/.test(found[1] ?? found[2]) && /^[A-Za-z]\.\s/.test(rest);
  return (isInitial ? line : rest).trim();
}

/** A choice's letter at the start of a line ("A.", "c)", "(b)"); group 1 is the letter. */
const CHOICE_MARK = /^\s*\(?([A-Ea-e])[.)]\s/;

/**
 * A row with two choices side by side as two lines ("A. Acute angle ⇥ C. Obtuse angle"): it splits at a gap of
 * spaces and tabs that holds a tab or 3+ spaces and comes right before a choice's letter. Any other gap stays (a tab
 * is a space later). Each gap is looked at once, so long runs of spaces read at once. (One pattern like
 * /(?:\t|[ ]{3,})+(?=…)/ tries every way to split a run of spaces and froze the tab on a line with 30 spaces.)
 */
function splitChoices(line: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const gap of line.matchAll(/[\t \u00a0]+/g)) {
    const end = gap.index + gap[0].length;
    if (/\t|[ \u00a0]{3}/.test(gap[0]) && /^\(?[A-Ea-e][.)]\s/.test(line.slice(end, end + 5))) {
      parts.push(line.slice(start, gap.index));
      start = end;
    }
  }
  parts.push(line.slice(start));
  return parts;
}

/** A line that starts a numbered exam item: "1. …", "12) …", or with a blank for the answer first, "____ 1. …". */
const QUESTION_LINE = /^\s*(?:_{2,}\s*)?\d{1,3}[.)]\s+\S/;

/** A suggested exam item: the question's line number and its answer choices' (up to 4). */
export type SuggestedItem = { question: number; options: number[] };

/**
 * The Word file panel's suggestions: each numbered line is a question, and the lines after it, up to 4 and
 * stopping at the next question, are its answer choices. An item needs at least 2 choices (true / false), so a
 * numbered line in the directions or a question with one line under it isn't suggested. Lettered choices are put in
 * A–D order (two columns side by side read A, C, B, D).
 */
export function suggestItems(lines: string[]): SuggestedItem[] {
  const items: SuggestedItem[] = [];
  lines.forEach((line, question) => {
    if (!QUESTION_LINE.test(line)) return;
    const options: number[] = [];
    for (let i = question + 1; i < lines.length && options.length < 4 && !QUESTION_LINE.test(lines[i]); i++) options.push(i);
    if (options.length < 2) return;
    // Two columns read A, C, B, D: when each choice has its own letter, they go in A–D order.
    const letters = options.map((i) => CHOICE_MARK.exec(lines[i])?.[1].toLowerCase());
    if (letters.every(Boolean) && new Set(letters).size === letters.length) {
      options.sort((a, b) => letters[options.indexOf(a)]!.localeCompare(letters[options.indexOf(b)]!));
    }
    items.push({ question, options });
  });
  return items;
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
  const texts = picked.slice(0, PICKED_LINES_MAX).map((i, place) => stripItemMark(lines[i] ?? "", place === 0 ? "question" : "option"));
  return { question: texts[0] ?? "", options: [texts[1] ?? "", texts[2] ?? "", texts[3] ?? "", texts[4] ?? ""] };
}
