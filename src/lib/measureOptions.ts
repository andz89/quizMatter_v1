/**
 * How tall each shown option needs its row to be, measured in the browser (the editor only): its text at its own
 * size and real width, wrapped like `SlideText`, plus the card's edges; at least the bottom of its lowest picture.
 * Used by the grid's re-fit after Shuffle / reorder (rows only), and by the click on an option's or the question's
 * "+…" mark, which finds the biggest text size that shows all of it (the only size change: the teacher's click).
 */
import { OPTION_FONT_SIZE, QUESTION_CONTAINER_ID, QUESTION_FONT_SIZE, getContainerBounds, getShownOptions } from "./constants";
import { OPTION_BORDER, OPTION_BOX_EDGES, largestFittingSize } from "./optionRows";
import { textToHtml, toSafeHtml } from "./richText";
import { FONT_SIZE_RANGE, type Option, type Slide } from "./schema";

let probe: HTMLDivElement | null = null;

// One hidden box, styled like SlideText (Lexend, line height 1.25, spaces kept, long words broken).
function getProbe(): HTMLDivElement {
  if (probe && probe.isConnected) return probe;
  probe = document.createElement("div");
  Object.assign(probe.style, {
    position: "absolute",
    left: "-10000px",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
    lineHeight: "1.25",
    whiteSpace: "break-spaces",
    overflowWrap: "break-word",
    fontFamily: "var(--font-sans)",
  });
  document.body.appendChild(probe);
  return probe;
}

// The question box's edges (p-4 and its 1.5px border, both sides), around its text.
const QUESTION_BOX_EDGES = 35;

/** How tall a text is at `fontSize` in a box `width` wide (slide px), wrapped like SlideText. */
function textHeight(text: string, html: string | undefined, width: number, fontSize: number): number {
  const box = getProbe();
  box.style.width = `${width}px`;
  box.style.fontSize = `${fontSize}px`;
  box.innerHTML = (html ? toSafeHtml(html) : textToHtml(text)).replace(/<p([^>]*)><\/p>/g, "<p$1><br></p>");
  return box.scrollHeight;
}

/** An option's text height at `fontSize` in its row (full width, like OptionCard: pictures sit on top of it). */
function optionTextHeight(slide: Slide, option: Option, fontSize: number): number {
  return textHeight(option.text, option.html, getContainerBounds(option.id, slide).width - OPTION_BOX_EDGES, fontSize);
}

/**
 * The biggest text size, from the option's own down, at which all its text shows in its row; the smallest size when
 * none does. For the teacher's click on the option's "+…" mark (the store's fitOptionText).
 */
export function fittingOptionFontSize(slide: Slide, option: Option): number {
  // 2 px spare: the real row can be a pixel or two shorter than the math (rows are shares of the real room).
  const room = getContainerBounds(option.id, slide).height - OPTION_BOX_EDGES - 2;
  return largestFittingSize(option.fontSize ?? OPTION_FONT_SIZE, FONT_SIZE_RANGE.min, (size) => optionTextHeight(slide, option, size) <= room);
}

/** The same for the question: the biggest size, from its own down, at which all of it shows in its box. */
export function fittingQuestionFontSize(slide: Slide): number {
  const bounds = getContainerBounds(QUESTION_CONTAINER_ID, slide);
  const room = bounds.height - QUESTION_BOX_EDGES - 2;
  const width = bounds.width - QUESTION_BOX_EDGES;
  return largestFittingSize(slide.questionFontSize ?? QUESTION_FONT_SIZE, FONT_SIZE_RANGE.min, (size) => textHeight(slide.question, slide.questionHtml, width, size) <= room);
}

/** Per shown option, in order: the height its row needs (px, in slide pixels). */
export function measureOptionNeeds(slide: Slide): number[] {
  return getShownOptions(slide).map((option) => {
    const pictures = slide.elements.filter((el) => el.containerId === option.id);
    const textNeed = optionTextHeight(slide, option, option.fontSize ?? OPTION_FONT_SIZE) + OPTION_BOX_EDGES;
    // Pictures sit inside the card's border, so the row needs the border too.
    const pictureNeed = Math.max(0, ...pictures.map((el) => el.y + el.height + OPTION_BORDER));
    return Math.max(textNeed, pictureNeed);
  });
}
