import { test } from "node:test";
import assert from "node:assert/strict";
import { keepUnsavedWork, takeKeptWork } from "./keptWork";
import type { Presentation, Slide } from "./schema";

// The browser's localStorage, which Node doesn't have.
function setStorage(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

/** A working localStorage, kept in a Map (returned, to look inside). */
function makeStorage(): Map<string, string> {
  const items = new Map<string, string>();
  setStorage({
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  });
  return items;
}

/** A blank slide. Its question is "'" when this tab changed it, so `names` shows b' for a changed b. */
function slide(id: string, question = ""): Slide {
  return {
    id,
    type: "blank",
    question,
    layout: "grid",
    options: [0, 1, 2, 3].map((i) => ({ id: `${id}-${i}`, text: "" })) as Slide["options"],
    correctOptionId: null,
    elements: [],
    questionHeight: 100,
  };
}

const names = (slides: Slide[] | undefined) => slides?.map((s) => s.id + s.question);

const saved: Presentation = {
  id: "p1",
  title: "Fractions",
  description: "",
  grades: [],
  subject: "",
  term: "",
  week: "",
  day: "",
  curriculum: "",
  learningCompetency: "",
  author: "",
  referenceLinks: [],
  tags: [],
  transition: "none",
  transitionSpeed: 3,
  isPublished: false,
  fromAdmin: false,
  slides: [],
  createdAt: 1,
  updatedAt: 1,
};

const a = slide("a");
const b = slide("b");
const c = slide("c");

/** Keeps this tab's slides (last saved as `savedSlides`), then opens the presentation with `loadedSlides`. */
function restore(savedSlides: Slide[], tabSlides: Slide[], loadedSlides: Slide[]) {
  makeStorage();
  const savedPresentation = { ...saved, slides: savedSlides };
  keepUnsavedWork({ presentation: { ...savedPresentation, slides: tabSlides }, savedPresentation, isReview: false });
  return takeKeptWork({ ...saved, slides: loadedSlides, updatedAt: 2 }, false);
}

test("keepUnsavedWork returns false when storage throws", (t) => {
  t.mock.method(console, "error", () => {});
  setStorage({
    getItem: () => null,
    setItem: () => {
      throw new Error("The storage is full.");
    },
    removeItem: () => {},
  });
  const savedPresentation = { ...saved, slides: [a] };
  const presentation = { ...savedPresentation, title: "Fractions 2" };
  assert.equal(keepUnsavedWork({ presentation, savedPresentation, isReview: false }), false);
});

test("keepUnsavedWork stores nothing and returns true when nothing changed", () => {
  const items = makeStorage();
  const savedPresentation = { ...saved, slides: [a, b] };
  // Only the publish switch (which failed) and the save time: not the teacher's edits.
  const presentation = { ...savedPresentation, isPublished: true, updatedAt: 2 };
  assert.equal(keepUnsavedWork({ presentation, savedPresentation, isReview: false }), true);
  assert.equal(items.size, 0);
});

test("restore keeps slides the newer save added", () => {
  const result = restore([a, b], [a, slide("b", "'")], [a, b, c]);
  assert.deepEqual(names(result?.slides), ["a", "b'", "c"]);
});

test("restore drops untouched slides the newer save deleted", () => {
  const result = restore([a, b], [slide("a", "'"), b], [a]);
  assert.deepEqual(names(result?.slides), ["a'"]);
});

test("restore keeps a deleted slide this tab changed", () => {
  const result = restore([a, b], [a, slide("b", "'")], [a]);
  assert.deepEqual(names(result?.slides), ["a", "b'"]);
});

test("restore keeps this tab's deletes", () => {
  const result = restore([a, b], [slide("a", "'")], [a, b]);
  assert.deepEqual(names(result?.slides), ["a'"]);
});

test("a Claude draft's kept work comes back whole", () => {
  makeStorage();
  // How store.ts does it: not in the database, so kept with no saved copy (saveBeforeLeaving) and put back over no
  // slides (restoreKeptWork), since Claude's slides are built again with new ids.
  const presentation = { ...saved, title: "Fractions 2", slides: [a, slide("b", "'")] };
  keepUnsavedWork({ presentation, savedPresentation: null, isReview: false });
  const result = takeKeptWork({ ...saved, slides: [] }, false);
  assert.deepEqual(names(result?.slides), ["a", "b'"]);
  assert.equal(result?.title, "Fractions 2");
});
