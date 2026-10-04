/** "Grade 4 · Mathematics", skipping the parts that aren't filled in. */
export function joinParts(parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

// Worked out on the server so the page shows the same text before and after it loads in the browser.
export function timeAgo(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(time).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export function slideCountLabel(count: number): string {
  return `${count} ${count === 1 ? "slide" : "slides"}`;
}

/** "Oct 4, 2026" from "2026-10-04" (a date with no time, so no time zone shift). */
export function formatDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "By Ms. Cruz · Published by andz": who wrote it (the Author detail) and whose account shared it. */
export function publishedByLine(author: string, publisherName: string | undefined): string {
  return joinParts([author && `By ${author}`, publisherName && `Published by ${publisherName}`]);
}

/** A day in UTC, like the photo cleanup's timer, e.g. "Sun, Oct 4". */
export function formatUtcDay(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** A file size, e.g. "412 KB" or "5.8 MB". */
export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
