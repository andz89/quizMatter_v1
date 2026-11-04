/**
 * Claude's "group" names → the editor's groups (an element's `groupId`). Items on one slide with the same name become
 * one group, like the editor's Group button: a click picks them all and they move together. Like that button, a group
 * needs at least 2 items, all in the same box. Kept apart from importPresentation.ts (which loads drawings) so it's
 * tested.
 */
export function groupByName<T extends { id: string; containerId: string | null; groupId?: string }>(
  elements: T[],
  // Element id → the group name Claude gave it.
  names: Map<string, string>,
  createId: () => string,
): { elements: T[]; lonely: string[]; mixed: string[] } {
  const members = new Map<string, T[]>();
  for (const el of elements) {
    const name = names.get(el.id);
    if (name !== undefined) members.set(name, [...(members.get(name) ?? []), el]);
  }

  const lonely: string[] = [];
  const mixed: string[] = [];
  const groupIds = new Map<string, string>();
  for (const [name, items] of members) {
    if (items.length < 2) lonely.push(name);
    else if (items.some((el) => el.containerId !== items[0].containerId)) mixed.push(name);
    else groupIds.set(name, createId());
  }

  return {
    elements: elements.map((el) => {
      const groupId = groupIds.get(names.get(el.id) ?? "");
      return groupId === undefined ? el : { ...el, groupId };
    }),
    lonely,
    mixed,
  };
}
