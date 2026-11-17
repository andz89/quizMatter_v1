import { DATA_VERSION, isNewerThanApp, slideSchema, type Slide } from "./schema";

/**
 * What a slide dragged from the editor's Presentations panel carries (under SLIDE_DRAG_MIME). The app version goes
 * with it: a drag can come from another tab, and one running newer app code would lose the fields this tab doesn't
 * know.
 */
export function slideDragData(slide: Slide): string {
  return JSON.stringify({ dataVersion: DATA_VERSION, slide });
}

/** The dropped slide, or why it can't be added: "newer" = from newer app code, "broken" = not a slide we can read. */
export function readSlideDrag(data: string): { slide: Slide } | { problem: "newer" | "broken" } {
  let parsed: { dataVersion?: unknown; slide?: unknown };
  try {
    parsed = JSON.parse(data);
  } catch {
    return { problem: "broken" };
  }
  if (typeof parsed?.dataVersion !== "number") return { problem: "broken" };
  if (isNewerThanApp(parsed.dataVersion)) return { problem: "newer" };
  const slide = slideSchema.safeParse(parsed.slide);
  return slide.success ? { slide: slide.data } : { problem: "broken" };
}
