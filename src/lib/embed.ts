// The slides that show something from another site, filling the slide: a video, a slide deck, or a picture.
export const EMBED_SLIDE_TYPES = ["video", "embed-slides", "image"] as const;
export type EmbedKind = (typeof EMBED_SLIDE_TYPES)[number];

// Takes any object with a type (not the Slide type): the slide schema itself uses this check.
export function isEmbedSlide<T extends { type?: string }>(slide: T): slide is T & { type: EmbedKind } {
  return (EMBED_SLIDE_TYPES as readonly (string | undefined)[]).includes(slide.type);
}

// Longest link an embed slide may keep (image links from some sites are long).
export const MAX_EMBED_URL_LENGTH = 2000;

export interface Embed {
  // What the slide shows: the player/viewer address for the iframe, or the picture's address.
  src: string;
  // A cover picture for small slide previews. Missing = none we can get.
  thumbnailUrl?: string;
  // Where it comes from, shown on previews that have no cover picture, e.g. "Canva".
  sourceName?: string;
}

const NOT_A_LINK: Record<EmbedKind, string> = {
  video: "Paste a YouTube, Vimeo or Canva video link.",
  "embed-slides": "Paste a Google Slides or Canva link.",
  image: "Paste a picture link that starts with https://",
};

/**
 * Reads what the teacher pasted into an embed slide's box — a link, or a whole embed code copied from
 * the site — and returns what the slide shows, or a message saying why it can't be used.
 * It also accepts its own `src`, so a saved slide passes the same check again.
 */
export function readEmbedLink(kind: EmbedKind, pasted: string): Embed | { error: string } {
  // An embed code (<iframe src="…">): keep only its link.
  const text = (pasted.match(/src=["']([^"']+)["']/i)?.[1] ?? pasted).trim().replaceAll("&amp;", "&");
  let link: URL;
  try {
    // People often paste links without "https://".
    link = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: NOT_A_LINK[kind] };
  }
  const host = link.hostname.replace(/^(www\.|m\.)/, "");
  const parts = link.pathname.split("/").filter(Boolean);

  if (host === "canva.link") {
    return { error: "Short canva.link links can't be read. In Canva, use Share → Embed and copy the link." };
  }
  if (kind !== "image" && host === "canva.com") return readCanvaLink(parts) ?? { error: NOT_A_LINK[kind] };

  if (kind === "video") return readVideoLink(link, host, parts) ?? { error: NOT_A_LINK[kind] };
  if (kind === "embed-slides") return readGoogleSlidesLink(host, parts) ?? { error: NOT_A_LINK[kind] };
  return readImageLink(link, host, parts);
}

/** canva.com/design/ID/CODE/view, …/view?embed or …/watch. Edit links can't be shown on other sites. */
function readCanvaLink(parts: string[]): Embed | { error: string } | null {
  if (parts[0] !== "design" || !/^[\w-]+$/.test(parts[1] ?? "")) return null;
  if (parts.includes("edit")) {
    return { error: "That's a Canva edit link. In Canva, use Share → Embed and copy the link." };
  }
  // The share code between the design id and "view" (missing on some public designs).
  const code = parts[2] && !["view", "watch"].includes(parts[2]) && /^[\w-]+$/.test(parts[2]) ? `${parts[2]}/` : "";
  return { src: `https://www.canva.com/design/${parts[1]}/${code}view?embed`, sourceName: "Canva" };
}

/** YouTube (watch?v=, youtu.be/, shorts/, embed/, live/) and Vimeo (vimeo.com/ID, unlisted ID/HASH, player links). */
function readVideoLink(link: URL, host: string, parts: string[]): Embed | null {
  let youtubeId: string | null = null;
  if (host === "youtu.be") youtubeId = parts[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") youtubeId = link.searchParams.get("v");
    else if (["shorts", "embed", "live"].includes(parts[0])) youtubeId = parts[1] ?? null;
  }
  if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) {
    return {
      src: `https://www.youtube.com/embed/${youtubeId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
      sourceName: "YouTube",
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const idIndex = parts.findIndex((part) => /^\d+$/.test(part));
    if (idIndex === -1) return null;
    const hash = link.searchParams.get("h") ?? (host === "vimeo.com" ? parts[idIndex + 1] : undefined);
    const query = hash && /^\w+$/.test(hash) ? `?h=${hash}` : "";
    return { src: `https://player.vimeo.com/video/${parts[idIndex]}${query}`, sourceName: "Vimeo" };
  }
  return null;
}

/**
 * docs.google.com/presentation/d/ID/… (shared with "Anyone with the link") or the "Publish to web"
 * link …/presentation/d/e/ID/pub.
 */
function readGoogleSlidesLink(host: string, parts: string[]): Embed | null {
  if (host !== "docs.google.com") return null;
  // Drop the "u/0" part links get when someone is signed in to more than one Google account.
  const path = parts.filter((part, i) => !(part === "u" || parts[i - 1] === "u"));
  if (path[0] !== "presentation" || path[1] !== "d") return null;
  const isPublished = path[2] === "e";
  const id = isPublished ? path[3] : path[2];
  if (!id || !/^[\w-]+$/.test(id)) return null;
  return {
    src: `https://docs.google.com/presentation/d/${isPublished ? "e/" : ""}${id}/embed?start=false&loop=false`,
    sourceName: "Google Slides",
  };
}

/** Any https picture link. Google Drive share links become Drive's picture address. */
function readImageLink(link: URL, host: string, parts: string[]): Embed | { error: string } {
  if (host === "drive.google.com") {
    // drive.google.com/file/d/ID/view, /open?id=ID, /uc?id=ID, or our own /thumbnail?id=ID
    const id = parts[0] === "file" && parts[1] === "d" ? parts[2] : link.searchParams.get("id");
    if (!id || !/^[\w-]+$/.test(id)) return { error: NOT_A_LINK.image };
    return { src: `https://drive.google.com/thumbnail?id=${id}&sz=w2000`, sourceName: "Google Drive" };
  }
  // http pictures are blocked on https pages, so only https ones can show.
  if (link.protocol !== "https:") return { error: NOT_A_LINK.image };
  return { src: link.href };
}
