import { presentationSchema, type Presentation } from "./schema";

// Unsaved work kept in this browser when a save is refused because newer app code saved the presentation (QMOLD,
// see the data_version migration). The tab reloads to get the new code, and the editor then puts the work back
// (upgraded to today's shape by presentationSchema). One per presentation; it stays until a save of that
// presentation works (forgetKeptWork), so a crash or a second load doesn't lose it. Storage can be blocked or full
// (private windows), so every read and write is allowed to fail: the work is then lost, as it would be without this.

const keyFor = (id: string) => `qm-unsaved:${id}`;

// Older kept work is thrown away instead of given back: by then it would replace newer saves the teacher forgot about.
const KEEP_FOR_MS = 7 * 24 * 60 * 60 * 1000;

// Not the teacher's own edits (a publish switch that failed, save times): always taken from the presentation as it
// opens now.
const NOT_EDITS = new Set(["id", "slides", "isPublished", "fromAdmin", "createdAt", "updatedAt"]);

// Only what the teacher changed since their last save is put back. The rest (untouched slides and details) comes
// from the presentation as it opens now, so it isn't sent again in the old shape over what the newer code saved.
type KeptWork = {
  presentation: Presentation;
  // Slides still the same as at the last save.
  unchangedSlideIds: string[];
  // Details (title, grades, …) changed since the last save.
  changedDetails: string[];
  isReview: boolean;
  keptAt: number;
};

/** Keeps the editor's unsaved presentation until a save of it works. */
export function keepUnsavedWork({
  presentation,
  savedPresentation,
  isReview,
}: {
  presentation: Presentation;
  savedPresentation: Presentation | null;
  isReview: boolean;
}): void {
  const savedSlides = new Set(savedPresentation?.slides);
  const work: KeptWork = {
    presentation,
    unchangedSlideIds: presentation.slides.filter((slide) => savedSlides.has(slide)).map((slide) => slide.id),
    changedDetails: Object.keys(presentation).filter(
      (key) => !NOT_EDITS.has(key) && presentation[key as keyof Presentation] !== savedPresentation?.[key as keyof Presentation]
    ),
    isReview,
    keptAt: Date.now(),
  };
  try {
    localStorage.setItem(keyFor(presentation.id), JSON.stringify(work));
  } catch (error) {
    console.error("Couldn't keep the unsaved work", error);
  }
}

/**
 * `loaded` (the presentation as it opens now) with the kept changes put back on it, or null. Null if there's none,
 * if it's older than KEEP_FOR_MS (then removed), if it was kept in the other mode (a review draft vs the owner's
 * editor), or if it can't be read even after upgrading (then it stays in storage, so it isn't lost for good).
 * Doesn't remove it: forgetKeptWork does, once it's saved.
 */
export function takeKeptWork(loaded: Presentation, isReview: boolean): Presentation | null {
  try {
    const text = localStorage.getItem(keyFor(loaded.id));
    if (text === null) return null;
    const kept = JSON.parse(text) as Partial<KeptWork>;
    if (typeof kept.keptAt !== "number" || Date.now() - kept.keptAt > KEEP_FOR_MS) {
      forgetKeptWork(loaded.id);
      return null;
    }
    if (kept.isReview !== isReview) return null;
    const result = presentationSchema.safeParse(kept.presentation);
    if (!result.success || result.data.id !== loaded.id) {
      console.error("Couldn't read the kept work", result.error);
      return null;
    }
    const work = result.data;
    const unchanged = new Set(Array.isArray(kept.unchangedSlideIds) ? kept.unchangedSlideIds : []);
    const loadedSlides = new Map(loaded.slides.map((slide) => [slide.id, slide]));
    // A detail renamed by an upgrade isn't in `work` under its old name: then the loaded one stays.
    const changed = (Array.isArray(kept.changedDetails) ? kept.changedDetails : []).filter(
      (key) => !NOT_EDITS.has(key) && key in work
    );
    return {
      ...loaded,
      ...Object.fromEntries(changed.map((key) => [key, work[key as keyof Presentation]])),
      slides: work.slides.map((slide) => (unchanged.has(slide.id) && loadedSlides.get(slide.id)) || slide),
    };
  } catch (error) {
    console.error("Couldn't read the kept work", error);
    return null;
  }
}

/** Removes the kept work for this presentation: it's saved now, or the teacher threw it away. */
export function forgetKeptWork(id: string): void {
  try {
    localStorage.removeItem(keyFor(id));
  } catch (error) {
    console.error("Couldn't remove the kept work", error);
  }
}
