/**
 * How tall each shown option needs its row to be, measured in the browser (the editor only): its text at its own
 * size and real width, wrapped like `SlideText`, plus the card's edges; at least the bottom of its lowest picture.
 * Used by the grid's re-fit after Shuffle / reorder (rows only; never a text size).
 */
import { OPTION_FONT_SIZE, getContainerBounds, getShownOptions } from "./constants";
import { OPTION_BORDER, OPTION_BOX_EDGES } from "./optionRows";
import { textToHtml, toSafeHtml } from "./richText";
import { markBlanks } from "./blanks";
import type { Option, Slide } from "./schema";

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

/** How tall a text is at `fontSize` in a box `width` wide (slide px), wrapped like SlideText. */
function textHeight(text: string, html: string | undefined, width: number, fontSize: number): number {
  const box = getProbe();
  box.style.width = `${width}px`;
  box.style.whiteSpace = "break-spaces";
  box.style.fontSize = `${fontSize}px`;
  box.innerHTML = (html ? toSafeHtml(html) : textToHtml(text)).replace(/<p([^>]*)><\/p>/g, "<p$1><br></p>");
  markBlanks(box);
  return box.scrollHeight;
}

/** An option's text height at `fontSize` in its row (full width, like OptionCard: pictures sit on top of it). */
function optionTextHeight(slide: Slide, option: Option, fontSize: number): number {
  return textHeight(option.text, option.html, getContainerBounds(option.id, slide).width - OPTION_BOX_EDGES, fontSize);
}

/** Per shown option, in order: the height its row needs (px, in slide pixels). */
export function measureOptionNeeds(slide: Slide): number[] {
  const needs = getShownOptions(slide).map((option) => {
    const pictures = slide.elements.filter((el) => el.containerId === option.id);
    const textNeed = optionTextHeight(slide, option, option.fontSize ?? OPTION_FONT_SIZE) + OPTION_BOX_EDGES;
    // Pictures sit inside the card's border, so the row needs the border too.
    const pictureNeed = Math.max(0, ...pictures.map((el) => el.y + el.height + OPTION_BORDER));
    return Math.max(textNeed, pictureNeed);
  });
  // Never leave a copy of the text behind in the page.
  getProbe().textContent = "";
  return needs;
}
