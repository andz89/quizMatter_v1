import type { SvgElement } from "./schema";

// The Layers panel's math (see "Layers panel" in src/components/editor/CLAUDE.md). Later in `slide.elements` =
// drawn on top, and only elements in the same box overlap, so each box has its own order.

/** One row of a box: an element, or a group (its members top first). */
export type LayerItem = { kind: "element"; element: SvgElement } | { kind: "group"; groupId: string; members: SvgElement[] };

/** A box's rows, top layer first. `containerId` null = on the slide itself. */
export type LayerBox = { containerId: string | null; items: LayerItem[] };

/** The rows of every box that has elements: free elements first, then the boxes in the order they're first met. */
export function layerBoxes(elements: SvgElement[]): LayerBox[] {
  const boxes = new Map<string | null, LayerBox>();
  if (elements.some((el) => el.containerId === null)) boxes.set(null, { containerId: null, items: [] });
  elements.forEach((el) => {
    if (!boxes.has(el.containerId)) boxes.set(el.containerId, { containerId: el.containerId, items: [] });
  });

  // Walk from the top layer down; a group's row sits where its top member is.
  const groups = new Map<string, SvgElement[]>();
  [...elements].reverse().forEach((element) => {
    const box = boxes.get(element.containerId)!;
    if (!element.groupId) return box.items.push({ kind: "element", element });
    const members = groups.get(element.groupId);
    if (members) return members.push(element);
    const newMembers = [element];
    groups.set(element.groupId, newMembers);
    box.items.push({ kind: "group", groupId: element.groupId, members: newMembers });
  });
  return [...boxes.values()];
}

/**
 * Moves `movingIds` (a whole row: one element, a whole group, or one member of a group) just above (drawn on top
 * of) or below the target's row, inside their box. Past another group it goes past the whole group; a member stays
 * inside its own group. Returns the same array when nothing would change or the move isn't allowed (another box,
 * onto itself), so a drop that changes nothing makes no undo step.
 */
export function moveLayer(elements: SvgElement[], movingIds: string[], targetId: string, place: "above" | "below"): SvgElement[] {
  const moving = new Set(movingIds);
  const target = elements.find((el) => el.id === targetId);
  const block = elements.filter((el) => moving.has(el.id));
  if (!target || moving.has(target.id) || block.length === 0) return elements;
  if (block.some((el) => el.containerId !== target.containerId)) return elements;

  // One member (not the whole group) moving: it may only go among its own group's members.
  const groupId = block[0].groupId;
  const isMemberMove =
    !!groupId && block.every((el) => el.groupId === groupId) && elements.some((el) => el.groupId === groupId && !moving.has(el.id));
  if (isMemberMove && target.groupId !== groupId) return elements;
  const targetBlock = new Set(
    !isMemberMove && target.groupId ? elements.filter((el) => el.groupId === target.groupId).map((el) => el.id) : [target.id]
  );

  const slots = elements.flatMap((el, i) => (el.containerId === target.containerId ? [i] : []));
  const others = slots.map((i) => elements[i]).filter((el) => !moving.has(el.id));
  const targetIndexes = others.flatMap((el, i) => (targetBlock.has(el.id) ? [i] : []));
  const insertAt = place === "above" ? Math.max(...targetIndexes) + 1 : Math.min(...targetIndexes);
  const reordered = [...others.slice(0, insertAt), ...block, ...others.slice(insertAt)];

  const result = [...elements];
  slots.forEach((slot, i) => (result[slot] = reordered[i]));
  return result.every((el, i) => el === elements[i]) ? elements : result;
}
