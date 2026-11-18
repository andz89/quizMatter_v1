/**
 * How tall each shown option needs its row to be, measured in the browser (the editor only): its text at its own
 * size and real width, wrapped like `SlideText`, plus the card's edges; at least the bottom of its lowest picture.
 * Used by the store's Fit rows to text and the grid's re-fit after Shuffle / reorder. Never changes a text size.
 */
import { OPTION_FONT_SIZE, getContainerBounds, getShownOptions } from "./constants";
import { OPTION_BORDER, OPTION_BOX_EDGES } from "./optionRows";
import { textToHtml, toSafeHtml } from "./richText";
import type { Slide } from "./schema";

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

/** Per shown option, in order: the height its row needs (px, in slide pixels). */
export function measureOptionNeeds(slide: Slide): number[] {
  const box = getProbe();
  return getShownOptions(slide).map((option) => {
    const pictures = slide.elements.filter((el) => el.containerId === option.id);
    const inner = getContainerBounds(option.id, slide).width - OPTION_BOX_EDGES;
    // With pictures, the text keeps to the left half (OptionCard).
    box.style.width = `${pictures.length ? inner / 2 : inner}px`;
    box.style.fontSize = `${option.fontSize ?? OPTION_FONT_SIZE}px`;
    box.innerHTML = (option.html ? toSafeHtml(option.html) : textToHtml(option.text)).replace(/<p([^>]*)><\/p>/g, "<p$1><br></p>");
    const textNeed = box.scrollHeight + OPTION_BOX_EDGES;
    // Pictures sit inside the card's border, so the row needs the border too.
    const pictureNeed = Math.max(0, ...pictures.map((el) => el.y + el.height + OPTION_BORDER));
    return Math.max(textNeed, pictureNeed);
  });
}
