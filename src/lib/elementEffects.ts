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

/**
 * The elements that come in one click at a time while presenting: element ids per step, in step order (in the
 * slide's own element order within a step). A group is one step. Empty on a slide that can't have element effects.
 */
export function effectSteps(slide: Slide): string[][] {
  if (!canHaveElementEffects(slide)) return [];
  const keys = stepKeys(slide.elements);
  const orders = [...new Set(keys.values())].sort((a, b) => a - b);
  return orders.map((order) => slide.elements.filter((e) => keys.get(e.id) === order).map((e) => e.id));
}

/** Element id → its 1-based step (the editor's badge and list). */
export function stepNumbers(slide: Slide): Map<string, number> {
  const numbers = new Map<string, number>();
  effectSteps(slide).forEach((ids, i) => ids.forEach((id) => numbers.set(id, i + 1)));
  return numbers;
}

/** The order a new step gets: one past the highest on the slide. */
export function nextEffectOrder(slide: Pick<Slide, "elements">): number {
  return Math.max(0, ...slide.elements.map((e) => e.effect?.order ?? 0)) + 1;
}

/**
 * Sets (or with null, removes) the effect of these elements (the caller passes whole groups). One that already has
 * an effect keeps its step; new ones go at the end, one step each in the slide's order, a group's members sharing
 * one. Returns a new slide.
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
  return { ...slide, elements };
}

/**
 * Copies (duplicate, paste) keep their effect and speed but come in last on the slide they're added to: each its own
 * new step, a copied group's members sharing one. Copies without an effect are returned as they are.
 */
export function effectsToEnd(copies: SvgElement[], slide: Pick<Slide, "elements">): SvgElement[] {
  let next = nextEffectOrder(slide);
  const groupOrders = new Map<string, number>();
  return copies.map((e) => {
    if (!e.effect) return e;
    let order = e.groupId ? groupOrders.get(e.groupId) : undefined;
    if (order === undefined) {
      order = next++;
      if (e.groupId) groupOrders.set(e.groupId, order);
    }
    return { ...e, effect: { ...e.effect, order } };
  });
}

/** Moves the step at place `from` to place `to` (0-based) and rewrites every order to 1..n. */
export function moveEffectStep(slide: Slide, from: number, to: number): Slide {
  const steps = effectSteps(slide);
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
