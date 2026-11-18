/**
 * Whether two settings hold the same values, whatever order their fields are in. The database re-sorts the keys of
 * saved data (`jsonb`), so a setting that comes back from a save can list them in another order than the panel builds
 * them. Lists keep their order.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
  );
}
