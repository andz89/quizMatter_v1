import type { FactorNode, Presentation, Slide, SvgElement } from "./schema";
import { gradesLabel } from "./schema";
import {
  ANSWER_CONTAINER_ID,
  QUESTION_CONTAINER_ID,
  SIDE_CONTAINER_ID,
  getItemCount,
  getShownOptions,
  getSlideNumbers,
  hasOptions,
  hasReveal,
  isDiscussionSlide,
} from "./constants";
import { DEFAULT_CALENDAR_DATE, formatCalendarDate } from "./calendarDate";
import {
  ANALOG_CLOCK_ID,
  BAR_GRAPH_ID,
  CALENDAR_IDS,
  DEFAULT_BAR_GRAPH,
  DEFAULT_CLOCK_TIME,
  DEFAULT_CYCLE,
  DEFAULT_FACTOR_TREE,
  DEFAULT_FLOWCHART,
  DEFAULT_MIND_MAP,
  DEFAULT_TREE,
  DIAGRAM_IDS,
  DIGITAL_CLOCK_ID,
} from "./elementDefaults";

/**
 * A presentation as readable parts, for the downloads (`markdownExport.ts` writes it as text, `wordExport.ts` as a
 * Word file). Only what reads as text: the details, and each slide's question, options, embed link, text boxes,
 * tables, diagrams, bar graphs, clocks, calendars and photos top to bottom. Other drawings are left out.
 * Only the chosen slides go in (`positions`, 1 = the first slide; missing = all). Slides have no labels: a question
 * slide starts with its number, counted like the editor's Q1, Q2 but among the chosen slides only ("1. Which…", a
 * custom slide "11–15. …"); other slides and hidden ones have none. Numbered questions' answers go in `answerKey`, for
 * the end of the file (a choice's as "A. Jupiter", with the option's pictures); any other slide's answer stays with
 * it (`answer`, called "Reveal" on blank and title slides, `answerLabel`). Elements are read box by box, the way the
 * slide reads: the question box's, then the strip or side box's, each option's under its letter, then the ones placed
 * freely, each group top to bottom (an element in a box is placed relative to that box).
 */
export interface PresentationOutline {
  title: string;
  description: string;
  details: { label: string; value: string }[];
  references: string[];
  slides: { blocks: OutlineBlock[]; answer: OutlineBlock[]; answerLabel: "Answer" | "Reveal" }[];
  answerKey: { number: string; answer: OutlineBlock[] }[];
}

export type OutlineBlock =
  | { kind: "text"; text: string } // can hold several lines
  | { kind: "options"; options: { letter: string; text: string; blocks: OutlineBlock[] }[] } // blocks = its pictures…
  | { kind: "link"; label: string; url: string } // an embed slide's link
  // Always our own storage (photoSchema); width = its box on the slide; crop and flips as the slide shows it.
  | { kind: "photo"; url: string; width: number; crop?: SvgElement["crop"]; flipX?: boolean; flipY?: boolean }
  | { kind: "table"; rows: string[][] } // the first row is the header
  | { kind: "list"; ordered: boolean; items: { text: string; depth: number }[] };

export function presentationOutline(presentation: Presentation, positions?: readonly number[]): PresentationOutline {
  const details = [
    ["Grades", gradesLabel(presentation.grades)],
    ["Subject", presentation.subject],
    ["Term", presentation.term],
    ["Week", presentation.week],
    ["Day", presentation.day],
    ["Curriculum", presentation.curriculum],
    ["Learning competency", presentation.learningCompetency],
    ["Author", presentation.author],
    ["Tags", presentation.tags.join(", ")],
  ]
    .map(([label, value]) => ({ label, value: value.trim() }))
    .filter(({ value }) => value);
  const slides = positions ? positions.map((position) => presentation.slides[position - 1]).filter(Boolean) : presentation.slides;
  const numbers = getSlideNumbers(slides);
  const outline: PresentationOutline = {
    title: presentation.title.trim() || "Untitled presentation",
    description: presentation.description.trim(),
    details,
    references: presentation.referenceLinks,
    slides: [],
    answerKey: [],
  };
  for (const slide of slides) {
    const number = numbers.get(slide.id);
    const label = number !== undefined && !isDiscussionSlide(slide) ? questionNumbers(slide, number) : null;
    const { blocks, answer } = slideOutline(slide, label);
    const answerLabel = hasReveal(slide) ? "Reveal" : "Answer";
    if (label === null) outline.slides.push({ blocks, answer, answerLabel });
    else {
      outline.slides.push({ blocks, answer: [], answerLabel });
      if (answer.length > 0) outline.answerKey.push({ number: label, answer });
    }
  }
  return outline;
}

/** One slide's parts, starting with its number (`label`, null = none), and its answer. */
function slideOutline(slide: Slide, label: string | null) {
  const blocks: OutlineBlock[] = [];

  const inBox = (containerId: string | null) => elementBlocks(slide.elements.filter((element) => element.containerId === containerId));

  const question = slide.questionHtml ? htmlToText(slide.questionHtml) : slide.question.trim();
  if (question) blocks.push({ kind: "text", text: question });
  blocks.push(...inBox(QUESTION_CONTAINER_ID), ...inBox(SIDE_CONTAINER_ID));

  // Each shown option with its text and its own pictures; an option with neither isn't shown on the slide.
  const options = hasOptions(slide)
    ? getShownOptions(slide).map((option, index) => ({
        id: option.id,
        letter: String.fromCharCode(65 + index),
        text: oneLine(option.html ? htmlToText(option.html) : option.text),
        blocks: inBox(option.id),
      }))
    : [];
  const shown = options.filter((option) => option.text || option.blocks.length > 0);
  if (shown.length > 0) blocks.push({ kind: "options", options: shown.map(({ letter, text, blocks }) => ({ letter, text, blocks })) });

  if (slide.embedUrl) blocks.push({ kind: "link", label: EMBED_WORDS[slide.type as keyof typeof EMBED_WORDS] ?? "Link", url: slide.embedUrl });
  blocks.push(...inBox(null));

  // A question's number goes in front of its first text, or on its own line when it starts with something else.
  if (label !== null) {
    const [first] = blocks;
    if (first?.kind === "text") blocks[0] = { kind: "text", text: `${label}. ${first.text}` };
    else blocks.unshift({ kind: "text", text: `${label}.` });
  }

  // A choice's answer is its right option, as "A. Jupiter", with the option's pictures ("C." alone for pictures only).
  const right = shown.find((option) => option.id === slide.correctOptionId);
  const answer: OutlineBlock[] = right
    ? [{ kind: "text", text: `${right.letter}.${right.text ? ` ${right.text}` : ""}` }, ...right.blocks]
    : slide.answerType === "canvas"
      ? inBox(ANSWER_CONTAINER_ID)
      : slide.correctAnswer?.trim()
        ? [{ kind: "text", text: slide.correctAnswer.trim() }]
        : [];
  return { blocks, answer };
}

const EMBED_WORDS = { video: "Video", "embed-slides": "Slides", image: "Picture" };

/** "3", or "3–7" for a custom slide with 5 items. */
function questionNumbers(slide: Slide, number: number): string {
  const items = getItemCount(slide);
  return items > 1 ? `${number}–${number + items - 1}` : `${number}`;
}

/** Each element that holds something to read, top to bottom (then left to right). */
function elementBlocks(elements: SvgElement[]): OutlineBlock[] {
  return [...elements]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(elementBlock)
    .filter((block): block is OutlineBlock => block !== null);
}

function elementBlock(element: SvgElement): OutlineBlock | null {
  if (element.text) {
    const text = htmlToText(element.text.html);
    return text ? { kind: "text", text } : null;
  }
  if (element.table) return { kind: "table", rows: element.table.rows.map((cells) => cells.map((cell) => oneLine(htmlToText(cell.html)))) };
  if (element.image) {
    const { crop, flipX, flipY } = element;
    return { kind: "photo", url: element.image.src, width: element.width, ...(crop && { crop }), ...(flipX && { flipX }), ...(flipY && { flipY }) };
  }
  // A clock, calendar, bar graph or diagram the teacher never changed saves no setting: it shows its starting one
  // (elementDefaults.ts), so the file does too.
  const { assetId } = element;
  const flowchart = element.flowchart ?? (assetId === DIAGRAM_IDS.flowchart ? DEFAULT_FLOWCHART : undefined);
  if (flowchart) return orderedList(flowchart.steps);
  const cycle = element.cycle ?? (assetId === DIAGRAM_IDS.cycle ? DEFAULT_CYCLE : undefined);
  if (cycle) return orderedList(cycle.steps);
  const mindMap = element.mindMap ?? (assetId === DIAGRAM_IDS.mindMap ? DEFAULT_MIND_MAP : undefined);
  if (mindMap) return bulletList([[mindMap.center.text, 0], ...mindMap.ideas.map((box) => [box.text, 1] as const)]);
  const tree = element.tree ?? (assetId === DIAGRAM_IDS.tree ? DEFAULT_TREE : undefined);
  if (tree) {
    return bulletList([
      [tree.root.text, 0],
      ...tree.branches.flatMap((branch) => [[branch.label.text, 1] as const, ...branch.leaves.map((leaf) => [leaf.text, 2] as const)]),
    ]);
  }
  const factorTree = element.factorTree ?? (assetId === DIAGRAM_IDS.factorTree ? DEFAULT_FACTOR_TREE : undefined);
  if (factorTree) return bulletList(factorTreeItems(factorTree.root, 0));
  const barGraph = element.barGraph ?? (assetId === BAR_GRAPH_ID ? DEFAULT_BAR_GRAPH : undefined);
  if (barGraph) return barGraph.bars.length > 0 ? bulletList(barGraph.bars.map((bar) => [`${bar.label}: ${bar.value}`, 0])) : null;
  if (element.clockTime || assetId === ANALOG_CLOCK_ID || assetId === DIGITAL_CLOCK_ID) {
    const { hours, minutes, pm } = element.clockTime ?? DEFAULT_CLOCK_TIME;
    // Like the slide: the digital clock always shows AM or PM, the analog one shows only its hands.
    const half = assetId === DIGITAL_CLOCK_ID ? (pm ? " PM" : " AM") : "";
    return { kind: "text", text: `Clock: ${hours}:${String(minutes).padStart(2, "0")}${half}` };
  }
  if (element.calendarDate || CALENDAR_IDS.includes(assetId)) {
    return { kind: "text", text: `Calendar: ${formatCalendarDate(element.calendarDate ?? DEFAULT_CALENDAR_DATE)}` };
  }
  return null;
}

function orderedList(boxes: { text: string }[]): OutlineBlock {
  return { kind: "list", ordered: true, items: boxes.map((box) => ({ text: oneLine(box.text), depth: 0 })) };
}

function bulletList(items: (readonly [string, number])[]): OutlineBlock {
  return { kind: "list", ordered: false, items: items.map(([text, depth]) => ({ text: oneLine(text), depth })) };
}

function factorTreeItems(node: FactorNode, depth: number): (readonly [string, number])[] {
  return [[node.text, depth], ...(node.children ?? []).flatMap((child) => factorTreeItems(child, depth + 1))];
}

export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** The text editor's HTML as plain text: each paragraph or line break on its own line. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** A download's file name: the title without characters files can't have, plus the extension (".txt", ".docx"). */
export function presentationFileName(title: string, extension: string): string {
  // Cut by whole characters (an emoji is two code units), then trimmed again so a cut never ends in a space.
  const cleaned = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const safe = Array.from(cleaned).slice(0, 100).join("").trim();
  return `${safe || "Presentation"}${extension}`;
}

/** Saves a file on the teacher's computer (browser only). */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Freed after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The Custom box's slide numbers ("1-3, 5, 8"; a dash or "–", any order, repeats once) for a presentation with `count`
 * slides, in order, or what's wrong in words.
 */
export function parseSlideNumbers(text: string, count: number): { numbers: number[] } | { error: string } {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { error: "Type the slide numbers, like 1-3, 5." };
  const numbers = new Set<number>();
  for (const part of parts) {
    const match = part.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
    if (!match) return { error: `"${part}" isn't a slide number. Type them like 1-3, 5.` };
    const [from, to] = [Number(match[1]), Number(match[2] ?? match[1])].sort((a, b) => a - b);
    if (from < 1 || to > count) return { error: `This presentation has ${count} ${count === 1 ? "slide" : "slides"}: use numbers from 1 to ${count}.` };
    for (let n = from; n <= to; n++) numbers.add(n);
  }
  return { numbers: [...numbers].sort((a, b) => a - b) };
}
