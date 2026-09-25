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
