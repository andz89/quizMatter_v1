import type { ElementEffectType, Slide, SvgElement } from "./schema";

// Same as SLIDE_EFFECT_SPEED_DEFAULT in schema.ts (only types are imported here, so `npm test` can load this file).
const DEFAULT_SPEED = 3;

/** Element effects are only for blank and title slides; question slides keep them saved but ignore them. */
export function canHaveElementEffects(slide: Pick<Slide, "type">): boolean {
  return slide.type === "blank" || slide.type === "title";
}

/** The step a group (or a lone element) is in: its members' lowest order. Null when none has an effect. */
function stepKeys(elements: SvgElement[]): Map<string, number> {
  const groupOrder = new Map<string, number>();
  for (const e of elements) {
    if (e.effect && e.groupId) groupOrder.set(e.groupId, Math.min(groupOrder.get(e.groupId) ?? Infinity, e.effect.order));
  }
  const keys = new Map<string, number>();
  for (const e of elements) {
    if (e.effect) keys.set(e.id, e.groupId ? groupOrder.get(e.groupId)! : e.effect.order);
  }
  return keys;
}

// Remembered per slide object (slides are never changed in place), since every element's badge asks for them.
const stepsCache = new WeakMap<Slide, string[][]>();
const numbersCache = new WeakMap<Slide, Map<string, number>>();

/**
 * The elements that come in one click at a time while presenting: element ids per step, in step order (in the
 * slide's own element order within a step). A group is one step. Empty on a slide that can't have element effects.
 */
export function effectSteps(slide: Slide): string[][] {
  const cached = stepsCache.get(slide);
  if (cached) return cached;
  const byOrder = new Map<number, string[]>();
  if (canHaveElementEffects(slide)) {
    const keys = stepKeys(slide.elements);
    for (const e of slide.elements) {
      const order = keys.get(e.id);
      if (order === undefined) continue;
      const ids = byOrder.get(order);
      if (ids) ids.push(e.id);
      else byOrder.set(order, [e.id]);
    }
  }
  const steps = [...byOrder.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
  stepsCache.set(slide, steps);
  return steps;
}

/** Element id → its 1-based step (the editor's badge and list). */
export function stepNumbers(slide: Slide): Map<string, number> {
  const cached = numbersCache.get(slide);
  if (cached) return cached;
  const numbers = new Map<string, number>();
  effectSteps(slide).forEach((ids, i) => ids.forEach((id) => numbers.set(id, i + 1)));
  numbersCache.set(slide, numbers);
  return numbers;
}

/** The order a new step gets: one past the highest on the slide. */
export function nextEffectOrder(slide: Pick<Slide, "elements">): number {
  return Math.max(0, ...slide.elements.map((e) => e.effect?.order ?? 0)) + 1;
}

/**
 * Keeps the steps tidy after a change that adds, groups or ungroups elements: a group is one whole step (every member
 * gets the effect of its lead, the member with the lowest order), and the orders are rewritten to 1..n in the same
 * order. So an order never climbs past the element count (the save check caps it at MAX_ELEMENTS). Any slide type.
 */
export function tidyEffects(elements: SvgElement[]): SvgElement[] {
  const leads = new Map<string, NonNullable<SvgElement["effect"]>>();
  for (const e of elements) {
    if (!e.effect || !e.groupId) continue;
    const lead = leads.get(e.groupId);
    if (!lead || e.effect.order < lead.order) leads.set(e.groupId, e.effect);
  }
  const whole = elements.map((e) => {
    const lead = e.groupId ? leads.get(e.groupId) : undefined;
    return lead && e.effect !== lead ? { ...e, effect: { ...lead } } : e;
  });
  const orders = [...new Set(whole.flatMap((e) => (e.effect ? [e.effect.order] : [])))].sort((a, b) => a - b);
  const rank = new Map(orders.map((order, i) => [order, i + 1]));
  return whole.map((e) => {
    const order = e.effect ? rank.get(e.effect.order)! : undefined;
    return e.effect && order !== e.effect.order ? { ...e, effect: { ...e.effect, order: order! } } : e;
  });
}

/**
 * Before ungrouping these elements: each member gets its own step, in the slide's order, right where the group's
 * step was (tidyEffects then makes the orders whole numbers again), so each can get its own effect afterwards.
 */
export function splitGroupSteps(elements: SvgElement[], ids: string[]): SvgElement[] {
  const picked = new Set(ids);
  const seen = new Map<string, number>();
  return elements.map((e) => {
    if (!picked.has(e.id) || !e.effect || !e.groupId) return e;
    const i = seen.get(e.groupId) ?? 0;
    seen.set(e.groupId, i + 1);
    // A slide holds at most MAX_ELEMENTS (1,000), so the offset stays below the next whole order.
    return i === 0 ? e : { ...e, effect: { ...e.effect, order: e.effect.order + i / 10000 } };
  });
}

/**
 * Sets (or with null, removes) the effect of these elements (the caller passes whole groups). One that already has
 * an effect keeps its step; new ones go at the end, one step each in the slide's order, a group's members sharing
 * one. Returns a new slide, its orders tidied.
 */
export function withEffect(slide: Slide, ids: string[], type: ElementEffectType | null, speed?: number): Slide {
  const picked = new Set(ids);
  let next = nextEffectOrder(slide);
  const groupOrders = new Map<string, number>();
  const elements = slide.elements.map((e): SvgElement => {
    if (!picked.has(e.id)) return e;
    if (type === null) {
      const rest = { ...e };
      delete rest.effect;
      return rest;
    }
    let order = e.effect?.order;
    if (order === undefined && e.groupId) order = groupOrders.get(e.groupId);
    if (order === undefined) order = next++;
    if (e.groupId && !groupOrders.has(e.groupId)) groupOrders.set(e.groupId, order);
    return { ...e, effect: { type, order, speed: speed ?? e.effect?.speed ?? DEFAULT_SPEED } };
  });
  return { ...slide, elements: tidyEffects(elements) };
}

/**
 * Adds copies (duplicate, paste) to the slide's elements: they keep their effect and speed but come in last, each its
 * own new step, a copied group's members sharing one. Returns the slide's new element list, its orders tidied.
 */
export function withCopiesAtEnd(slide: Pick<Slide, "elements">, copies: SvgElement[]): SvgElement[] {
  let next = nextEffectOrder(slide);
  const groupOrders = new Map<string, number>();
  const moved = copies.map((e) => {
    if (!e.effect) return e;
    let order = e.groupId ? groupOrders.get(e.groupId) : undefined;
    if (order === undefined) {
      order = next++;
      if (e.groupId) groupOrders.set(e.groupId, order);
    }
    return { ...e, effect: { ...e.effect, order } };
  });
  return tidyEffects([...slide.elements, ...moved]);
}

/** An effect as Claude's recipe and read_presentation write it: the step it comes in at (1-based) instead of `order`. */
export interface RecipeEffect {
  type: ElementEffectType;
  step: number;
  speed?: number;
}

/**
 * Claude's import: puts the effects Claude gave (element id → its recipe effect) on the slide's elements, tidied like
 * the editor's (steps 1..n, a group one whole step). On a slide that can't have element effects, none is kept and
 * `ignored` is true, so the layout report can say so.
 */
export function applyRecipeEffects(
  slide: Pick<Slide, "type" | "elements">,
  effects: Map<string, RecipeEffect>,
): { elements: SvgElement[]; ignored: boolean } {
  if (effects.size === 0) return { elements: slide.elements, ignored: false };
  if (!canHaveElementEffects(slide)) return { elements: slide.elements, ignored: true };
  const elements = slide.elements.map((e) => {
    const effect = effects.get(e.id);
    return effect ? { ...e, effect: { type: effect.type, order: effect.step, speed: effect.speed ?? DEFAULT_SPEED } } : e;
  });
  return { elements: tidyEffects(elements), ignored: false };
}

/** read_presentation: an element's effect in the recipe's words (its step), or undefined when it has none that plays. */
export function recipeEffectOf(slide: Slide, element: SvgElement): RecipeEffect | undefined {
  const step = element.effect ? stepNumbers(slide).get(element.id) : undefined;
  return element.effect && step ? { type: element.effect.type, step, speed: element.effect.speed } : undefined;
}

/** Moves the step at place `from` to place `to` (0-based) and rewrites every order to 1..n. */
export function moveEffectStep(slide: Slide, from: number, to: number): Slide {
  const steps = [...effectSteps(slide)];
  if (from === to || !steps[from] || !steps[to]) return slide;
  const [moved] = steps.splice(from, 1);
  steps.splice(to, 0, moved);
  const orderOf = new Map<string, number>();
  steps.forEach((ids, i) => ids.forEach((id) => orderOf.set(id, i + 1)));
  return {
    ...slide,
    elements: slide.elements.map((e) => (e.effect && orderOf.has(e.id) ? { ...e, effect: { ...e.effect, order: orderOf.get(e.id)! } } : e)),
  };
}
