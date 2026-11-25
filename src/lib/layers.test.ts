import { test } from "node:test";
import assert from "node:assert/strict";
import { layerBoxes, moveLayer, shownLayerBoxes } from "./layers";
import type { Slide, SvgElement } from "./schema";

// A small element: only the fields the layer helpers read matter.
function el(id: string, containerId: string | null = null, groupId?: string): SvgElement {
  return { id, assetId: "circle", x: 0, y: 0, width: 10, height: 10, color: "#000000", containerId, groupId };
}

const ids = (elements: SvgElement[]) => elements.map((e) => e.id);

test("layerBoxes lists each box top layer first, free elements first", () => {
  const boxes = layerBoxes([el("q1", "question"), el("a"), el("q2", "question"), el("b")]);
  assert.deepEqual(boxes.map((b) => b.containerId), [null, "question"]);
  assert.deepEqual(boxes[0].items.map((i) => i.kind === "element" && i.element.id), ["b", "a"]);
  assert.deepEqual(boxes[1].items.map((i) => i.kind === "element" && i.element.id), ["q2", "q1"]);
});

test("layerBoxes folds a group into one row at its top member's place, members top first", () => {
  const boxes = layerBoxes([el("a"), el("g1", null, "G"), el("b"), el("g2", null, "G")]);
  const items = boxes[0].items;
  assert.equal(items.length, 3);
  assert.equal(items[0].kind, "group");
  assert.deepEqual(items[0].kind === "group" && ids(items[0].members), ["g2", "g1"]);
  assert.deepEqual(items.slice(1).map((i) => i.kind === "element" && i.element.id), ["b", "a"]);
});

test("layerBoxes of no elements is empty", () => {
  assert.deepEqual(layerBoxes([]), []);
});

test("moveLayer puts an element above (drawn on top of) the target", () => {
  const elements = [el("a"), el("b"), el("c")];
  assert.deepEqual(ids(moveLayer(elements, ["a"], "c", "above")), ["b", "c", "a"]);
  assert.deepEqual(ids(moveLayer(elements, ["c"], "a", "below")), ["c", "a", "b"]);
  assert.deepEqual(ids(moveLayer(elements, ["a"], "c", "below")), ["b", "a", "c"]);
});

test("moveLayer only reorders the target's box, leaving other boxes in their places", () => {
  const elements = [el("a"), el("q", "question"), el("b")];
  assert.deepEqual(ids(moveLayer(elements, ["a"], "b", "above")), ["b", "q", "a"]);
});

test("moveLayer refuses a target in another box", () => {
  const elements = [el("a"), el("q", "question")];
  assert.equal(moveLayer(elements, ["a"], "q", "above"), elements);
});

test("moveLayer returns the same array when nothing changes", () => {
  const elements = [el("a"), el("b")];
  assert.equal(moveLayer(elements, ["b"], "a", "above"), elements);
  assert.equal(moveLayer(elements, ["a"], "a", "above"), elements);
  assert.equal(moveLayer(elements, ["a"], "missing", "above"), elements);
});

test("moveLayer moves a whole group and never lands between another group's members", () => {
  const elements = [el("a"), el("g1", null, "G"), el("g2", null, "G"), el("h1", null, "H"), el("h2", null, "H")];
  // Group H dropped below g2: it goes below the whole of group G.
  assert.deepEqual(ids(moveLayer(elements, ["h1", "h2"], "g2", "below")), ["a", "h1", "h2", "g1", "g2"]);
  // A single element dropped above g1 goes above the whole group.
  assert.deepEqual(ids(moveLayer(elements, ["a"], "g1", "above")), ["g1", "g2", "a", "h1", "h2"]);
});

test("moveLayer reorders a member inside its own group, but never takes it out", () => {
  const elements = [el("g1", null, "G"), el("g2", null, "G"), el("g3", null, "G"), el("b")];
  assert.deepEqual(ids(moveLayer(elements, ["g1"], "g3", "above")), ["g2", "g3", "g1", "b"]);
  assert.equal(moveLayer(elements, ["g1"], "b", "above"), elements);
});

// A slide with one element in each box; `change` sets its kind.
function slideWith(change: Partial<Slide>): Slide {
  return {
    id: "s",
    question: "",
    layout: "grid",
    options: ["a", "b", "c", "d"].map((id) => ({ id, text: "" })),
    correctOptionId: null,
    questionHeight: 150,
    elements: [el("free"), el("q", "question"), el("a1", "a"), el("c1", "c"), el("side1", "side"), el("ans", "answer")],
    ...change,
  } as Slide;
}
const shown = (slide: Slide) => shownLayerBoxes(slide).map((b) => b.name).join("|");

test("shownLayerBoxes names every box a choice slide shows", () => {
  assert.equal(shown(slideWith({ type: "choice", hasShapeBox: true })), "On the slide|Question|Answer A|Answer C|Shape box");
});

test("shownLayerBoxes leaves out boxes the slide doesn't show", () => {
  // True or false shows only the first two answers; no shape box unless the slide has one.
  assert.equal(shown(slideWith({ type: "true-false" })), "On the slide|Question|Answer A");
  // A blank slide has no question or answer boxes; its drawn answer shows only as a drawing ("canvas").
  assert.equal(shown(slideWith({ type: "blank" })), "On the slide");
  assert.equal(shown(slideWith({ type: "blank", answerType: "canvas" })), "On the slide|Reveal");
  assert.equal(shown(slideWith({ type: "short-answer", answerType: "canvas" })), "On the slide|Question|Answer");
  // An embed slide holds only its video or deck.
  assert.equal(shown(slideWith({ type: "video" } as Partial<Slide>)), "");
});

test("shownLayerBoxes keeps the shape box beside the rows", () => {
  assert.equal(shown(slideWith({ type: "choice", layout: "list-side" })), "On the slide|Question|Answer A|Answer C|Shape box");
});
