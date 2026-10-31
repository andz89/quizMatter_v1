// YouTube links in announcements (the modal's YouTube card; spec
// docs/superpowers/specs/2026-10-31-announcement-post-design.md).

/** A YouTube video id: always 11 letters, digits, "-" or "_". */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

/**
 * The video id of a YouTube link, or null for anything else: youtube.com/watch?v=…, youtu.be/…,
 * youtube.com/shorts/… and youtube.com/embed/….
 */
export function youTubeVideoId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  let id: string | null = null;
  if (url.hostname === "youtu.be") {
    id = url.pathname.slice(1);
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/)?.[1] ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** The first YouTube video linked in some text (e.g. what was pasted), or null. */
export function findYouTubeVideoId(text: string): string | null {
  for (const word of text.split(/\s+/)) {
    const id = youTubeVideoId(word.replace(/[.,;:!?)\]]+$/, ""));
    if (id) return id;
  }
  return null;
}

/** Where a YouTube card leads (a new tab). */
export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
