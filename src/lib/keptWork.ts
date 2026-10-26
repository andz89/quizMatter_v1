import { presentationSchema, type Presentation, type Slide } from "./schema";

// Unsaved work kept in this browser when a save is refused because newer app code saved the presentation (QMOLD,
// see the data_version migration), or when the save on leaving the editor fails (saveBeforeLeaving in store.ts).
// After a QMOLD the tab reloads to get the new code. The editor puts the work back the next time it opens that
// presentation (upgraded to today's shape by presentationSchema). One per presentation; it stays until a save of that
// presentation works (forgetKeptWork), so a crash or a second load doesn't lose it. Storage can be blocked or full
// (private windows), so every read and write is allowed to fail: keepUnsavedWork then says so (false), and the
// editor tells the teacher.

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
  // The slides at the last save, so restoring can tell slides a newer save added from ones this tab deleted.
  savedSlideIds: string[];
  // Details (title, grades, …) changed since the last save.
  changedDetails: string[];
  isReview: boolean;
  keptAt: number;
};

/**
 * Keeps the editor's unsaved presentation until a save of it works. True when it's kept, or when there's nothing
 * worth keeping (no edits, e.g. only a publish switch failed: then nothing is stored). False when the browser
 * couldn't store it.
 */
export function keepUnsavedWork({
  presentation,
  savedPresentation,
  isReview,
}: {
  presentation: Presentation;
  savedPresentation: Presentation | null;
  isReview: boolean;
}): boolean {
  const savedSlides = savedPresentation?.slides ?? [];
  const savedSlideSet = new Set(savedSlides);
  const changedDetails = Object.keys(presentation).filter(
    (key) => !NOT_EDITS.has(key) && presentation[key as keyof Presentation] !== savedPresentation?.[key as keyof Presentation]
  );
  const sameSlides =
    presentation.slides.length === savedSlides.length && presentation.slides.every((slide, i) => slide === savedSlides[i]);
  if (sameSlides && changedDetails.length === 0) return true;
  const work: KeptWork = {
    presentation,
    unchangedSlideIds: presentation.slides.filter((slide) => savedSlideSet.has(slide)).map((slide) => slide.id),
    savedSlideIds: savedSlides.map((slide) => slide.id),
    changedDetails,
    isReview,
    keptAt: Date.now(),
  };
  try {
    localStorage.setItem(keyFor(presentation.id), JSON.stringify(work));
    return true;
  } catch (error) {
    console.error("Couldn't keep the unsaved work", error);
    return false;
  }
}

/**
 * The kept slides merged with the ones as they open now. Walked in the kept order: an untouched slide becomes the
 * loaded one (dropped if a newer save deleted it), a changed or new one stays. Then each loaded slide that wasn't
 * there at this tab's last save (a newer save added it) goes in right after the nearest slide before it that's in
 * the result, or first. A slide this tab deleted stays deleted.
 */
function mergeSlides(kept: Slide[], unchangedIds: Set<string>, savedIds: Set<string>, loaded: Slide[]): Slide[] {
  const loadedById = new Map(loaded.map((slide) => [slide.id, slide]));
  const slides = kept.flatMap((slide) => (unchangedIds.has(slide.id) ? (loadedById.get(slide.id) ?? []) : slide));
  const keptIds = new Set(kept.map((slide) => slide.id));
  loaded.forEach((slide, i) => {
    if (savedIds.has(slide.id) || keptIds.has(slide.id)) return;
    const before = loaded
      .slice(0, i)
      .map((earlier) => slides.findIndex((s) => s.id === earlier.id))
      .findLast((index) => index !== -1);
    slides.splice(before === undefined ? 0 : before + 1, 0, slide);
  });
  return slides;
}

/**
 * `loaded` (the presentation as it opens now) with the kept changes put back on it, or null. Null if there's none,
 * if it's older than KEEP_FOR_MS (then removed), if it was kept in the other mode (a review draft vs the owner's
 * editor), if it can't be read even after upgrading (then it stays in storage, so it isn't lost for good), or if it
 * gives back nothing that isn't already in `loaded`. Doesn't remove it: forgetKeptWork does, once it's saved.
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
    let slides = mergeSlides(
      work.slides,
      new Set(Array.isArray(kept.unchangedSlideIds) ? kept.unchangedSlideIds : []),
      new Set(Array.isArray(kept.savedSlideIds) ? kept.savedSlideIds : []),
      loaded.slides
    );
    // A presentation always has a slide. None left (this tab and the newer save deleted all the others between
    // them): the loaded ones stay.
    if (slides.length === 0) slides = loaded.slides;
    // A detail renamed by an upgrade isn't in `work` under its old name: then the loaded one stays. One the newer
    // save gave the same value isn't a change.
    const changed = (Array.isArray(kept.changedDetails) ? kept.changedDetails : []).filter(
      (key) =>
        !NOT_EDITS.has(key) &&
        key in work &&
        JSON.stringify(work[key as keyof Presentation]) !== JSON.stringify(loaded[key as keyof Presentation])
    );
    const sameSlides = slides.length === loaded.slides.length && slides.every((slide, i) => slide === loaded.slides[i]);
    // Nothing to give back.
    if (sameSlides && changed.length === 0) return null;
    return {
      ...loaded,
      ...Object.fromEntries(changed.map((key) => [key, work[key as keyof Presentation]])),
      slides,
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
