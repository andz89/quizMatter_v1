// The counting behind Admin → Safety's "Password resets" lists (PasswordResets.tsx). Plain .ts, so npm test can check it.

/** One row of password_reset_sends (key = the teacher) or password_reset_requests (key = the internet address). */
export type ResetRow = { key: string; at: string };

/** How many rows one teacher or address has, and its newest one. */
export type ResetCount = { key: string; count: number; lastAt: string };

/** The rows counted per key, the most first, then the newest. */
export function countResets(rows: ResetRow[]): ResetCount[] {
  const byKey = new Map<string, ResetCount>();
  for (const row of rows) {
    const count = byKey.get(row.key);
    if (!count) byKey.set(row.key, { key: row.key, count: 1, lastAt: row.at });
    else {
      count.count++;
      if (Date.parse(row.at) > Date.parse(count.lastAt)) count.lastAt = row.at;
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/** When today started in the Philippines (UTC+8, no summer time), as UTC: the database's manila_today() at midnight. */
export function startOfManilaDay(now: number): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
  return new Date(`${day}T00:00:00+08:00`).toISOString();
}
