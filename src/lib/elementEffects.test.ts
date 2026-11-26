import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRecipeEffects,
  canHaveElementEffects,
  effectSteps,
  moveEffectStep,
  nextEffectOrder,
  recipeEffectOf,
  splitGroupSteps,
  stepNumbers,
  tidyEffects,
  withCopiesAtEnd,
  withEffect,
} from "./elementEffects";
import { slideSchema, type Slide, type SvgElement } from "./schema";

type Effect = SvgElement["effect"];
const el = (id: string, effect?: Effect, groupId?: string) =>
  ({ id, assetId: "star", x: 0, y: 0, width: 10, height: 10, color: "#000000", containerId: null, effect, groupId }) as SvgElement;
const slide = (elements: SvgElement[], type: Slide["type"] = "blank") => ({ id: "s1", type, elements }) as Slide;
const fx = (order: number, type: "fade" | "pop" = "fade") => ({ type, order, speed: 3 });

test("effectSteps sorts by order and skips elements without an effect", () => {
  assert.deepEqual(effectSteps(slide([el("a", fx(2)), el("b", fx(1)), el("c")])), [["b"], ["a"]]);
});

test("effectSteps ignores gaps in the orders", () => {
  assert.deepEqual(effectSteps(slide([el("a", fx(1)), el("b", fx(5)), el("c", fx(9))])), [["a"], ["b"], ["c"]]);
});

test("a group is one step, at its members' lowest order", () => {
  const s = slide([el("x", fx(2)), el("m1", fx(3), "g1"), el("m2", fx(1), "g1")]);
  assert.deepEqual(effectSteps(s), [["m1", "m2"], ["x"]]);
});

test("separate elements with the same order appear together", () => {
  assert.deepEqual(effectSteps(slide([el("a", fx(1)), el("b", fx(1))])), [["a", "b"]]);
});

test("only blank and title slides use element effects", () => {
  assert.deepEqual(effectSteps(slide([el("a", fx(1))], "choice")), []);
  assert.equal(canHaveElementEffects({ type: "blank" }), true);
  assert.equal(canHaveElementEffects({ type: "title" }), true);
  for (const type of ["choice", "true-false", "short-answer", "custom", "video"] as const) {
    assert.equal(canHaveElementEffects({ type }), false, type);
  }
});

test("stepNumbers gives each element its 1-based step", () => {
  const numbers = stepNumbers(slide([el("a", fx(4)), el("b", fx(2)), el("c")]));
  assert.deepEqual([...numbers].sort(), [["a", 2], ["b", 1]]);
});

test("nextEffectOrder is one past the highest order", () => {
  assert.equal(nextEffectOrder(slide([el("a")])), 1);
  assert.equal(nextEffectOrder(slide([el("a", fx(7)), el("b", fx(2))])), 8);
});

test("withEffect gives new elements their own steps at the end", () => {
  const before = slide([el("a", fx(1)), el("b"), el("c")]);
  const after = withEffect(before, ["c", "b"], "pop");
  assert.notEqual(after, before);
  const byId = new Map(after.elements.map((e) => [e.id, e.effect]));
  assert.deepEqual(byId.get("b"), { type: "pop", order: 2, speed: 3 });
  assert.deepEqual(byId.get("c"), { type: "pop", order: 3, speed: 3 });
});

test("withEffect gives a group's members one step", () => {
  const after = withEffect(slide([el("m1", undefined, "g"), el("m2", undefined, "g")]), ["m1", "m2"], "fade");
  assert.deepEqual(after.elements.map((e) => e.effect?.order), [1, 1]);
});

test("withEffect keeps an existing step when the type or speed changes, and null removes it", () => {
  const before = slide([el("a", fx(1)), el("b", fx(2))]);
  const changed = withEffect(before, ["a"], "pop", 5);
  assert.deepEqual(changed.elements[0].effect, { type: "pop", order: 1, speed: 5 });
  const removed = withEffect(before, ["b"], null);
  assert.equal(removed.elements[1].effect, undefined);
  assert.equal("effect" in removed.elements[1], false);
});

test("moveEffectStep moves a step and rewrites orders 1..n", () => {
  const s = slide([el("a", fx(1)), el("b", fx(4)), el("c", fx(9))]);
  const moved = moveEffectStep(s, 0, 2);
  assert.deepEqual(effectSteps(moved), [["b"], ["c"], ["a"]]);
  assert.deepEqual(moved.elements.map((e) => e.effect?.order), [3, 1, 2]);
  assert.equal(moveEffectStep(s, 1, 1), s);
});

test("copies keep their effect but come in last, a copied group sharing one step", () => {
  const target = slide([el("a", fx(4))]);
  const all = withCopiesAtEnd(target, [el("c1", fx(1, "pop")), el("g1", fx(2), "new-g"), el("g2", fx(2), "new-g"), el("plain")]);
  assert.deepEqual(all.map((e) => e.effect?.order), [1, 2, 3, 3, undefined]);
  assert.equal(all[1].effect?.type, "pop");
});

test("duplicating and deleting again and again never pushes an order past the step count", () => {
  let s = slide([el("a0", fx(1))]);
  for (let i = 1; i <= 1200; i++) {
    const copies = withCopiesAtEnd(s, [{ ...s.elements[0], id: `a${i}` }]);
    s = { ...s, elements: copies.slice(1) }; // the original is deleted
  }
  // Deleting leaves a gap (the copy is 2); the next add closes it, so it never climbs.
  assert.deepEqual(s.elements.map((e) => e.effect?.order), [2]);
});

test("tidyEffects rewrites orders 1..n and makes a group one whole step with its lead's effect", () => {
  const tidied = tidyEffects([el("x", fx(7)), el("m1", fx(5, "pop"), "g"), el("m2", undefined, "g"), el("m3", fx(9), "g"), el("y")]);
  assert.deepEqual(
    tidied.map((e) => e.effect),
    [fx(2), fx(1, "pop"), fx(1, "pop"), fx(1, "pop"), undefined]
  );
});

test("splitGroupSteps gives each former member its own step where the group was", () => {
  const before = [el("a", fx(1)), el("m1", fx(2), "g"), el("m2", fx(2), "g"), el("b", fx(3))];
  const after = tidyEffects(splitGroupSteps(before, ["m1", "m2"]).map((e) => ({ ...e, groupId: undefined })));
  assert.deepEqual(after.map((e) => e.effect?.order), [1, 2, 3, 4]);
});

test("effectSteps is the same answer for the same slide object", () => {
  const s = slide([el("a", fx(1))]);
  assert.equal(effectSteps(s), effectSteps(s));
  assert.equal(stepNumbers(s), stepNumbers(s));
});

test("a saved effect with bad values is left out, and the slide still opens", () => {
  const parsed = slideSchema.parse({
    id: "s1",
    type: "blank",
    question: "",
    layout: "grid",
    options: ["a", "b", "c", "d"].map((id) => ({ id, text: "" })),
    correctOptionId: null,
    questionHeight: 100,
    elements: [
      { ...el("bad"), effect: { type: "spin", order: 0, speed: 9 } },
      { ...el("good"), effect: fx(1, "pop") },
    ],
  });
  assert.equal(parsed.elements[0].effect, undefined);
  assert.deepEqual(parsed.elements[1].effect, fx(1, "pop"));
});

test("applyRecipeEffects puts Claude's steps on the elements, tidied, a group as one step", () => {
  const s = slide([el("t"), el("a"), el("r", undefined, "g"), el("w", undefined, "g")]);
  const effects = new Map([
    ["a", { type: "pop" as const, step: 7 }],
    ["r", { type: "fade" as const, step: 3, speed: 5 }],
  ]);
  const { elements, ignored } = applyRecipeEffects(s, effects);
  assert.equal(ignored, false);
  assert.deepEqual(
    elements.map((e) => e.effect),
    [undefined, { type: "pop", order: 2, speed: 3 }, { type: "fade", order: 1, speed: 5 }, { type: "fade", order: 1, speed: 5 }],
  );
});

test("applyRecipeEffects keeps none on a question slide and says so", () => {
  const s = slide([el("a")], "choice");
  const { elements, ignored } = applyRecipeEffects(s, new Map([["a", { type: "fade" as const, step: 1 }]]));
  assert.equal(ignored, true);
  assert.equal(elements[0].effect, undefined);
  assert.equal(applyRecipeEffects(s, new Map()).ignored, false);
});

test("recipeEffectOf gives the click a piece comes in at, only where effects play", () => {
  const s = slide([el("a", fx(4)), el("b", fx(9, "pop")), el("c")]);
  assert.deepEqual(recipeEffectOf(s, s.elements[1]), { type: "pop", step: 2, speed: 3 });
  assert.equal(recipeEffectOf(s, s.elements[2]), undefined);
  const question = slide([el("a", fx(1))], "choice");
  assert.equal(recipeEffectOf(question, question.elements[0]), undefined);
});
