// Facebook posts and videos in announcements: shown with Facebook's own embedded player / post box (the modal's
// attachment, kind "facebook"; root CLAUDE.md, "Announcements"). Only the link is saved; the frame's address is
// built here from a checked link, so nothing else can get into it.

export type FacebookLink = { href: string; video: boolean };

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"]);
const MAX_LENGTH = 500;
// Facebook's post box is 350–750 px wide and reads best at 500 at most.
const POST_MIN_WIDTH = 350;
const POST_MAX_WIDTH = 500;

/**
 * A Facebook post or video link, always as https (no #part), or null for anything else: a page, a profile, another
 * site, or a link with spaces, quotes or < >.
 */
export function facebookLink(link: string): FacebookLink | null {
  const trimmed = link.trim();
  if (/[\s"'<>]/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname;
  let video: boolean;
  if (url.hostname === "fb.watch") {
    if (path.length < 2) return null;
    video = true;
  } else if (FACEBOOK_HOSTS.has(url.hostname)) {
    if (/\/videos\/|^\/reel\/[^/]+|^\/share\/[vr]\/[^/]+/.test(path) || (path.startsWith("/watch") && url.searchParams.has("v"))) {
      video = true;
    } else if (
      /\/posts\/[^/]+|^\/share\/p\/[^/]+/.test(path) ||
      ((path === "/permalink.php" || path === "/story.php") && url.searchParams.has("story_fbid")) ||
      ((path === "/photo/" || path === "/photo" || path === "/photo.php") && url.searchParams.has("fbid"))
    ) {
      video = false;
    } else {
      return null;
    }
  } else {
    return null;
  }
  const href = `https://${url.hostname}${url.pathname}${url.search}`;
  return href.length <= MAX_LENGTH ? { href, video } : null;
}

/** The first Facebook post or video linked in some text (e.g. what was pasted), or null. */
export function findFacebookLink(text: string): FacebookLink | null {
  for (const word of text.split(/\s+/)) {
    const found = facebookLink(word.replace(/[.,;:!?)\]]+$/, ""));
    if (found) return found;
  }
  return null;
}

/** How wide Facebook's post box is in a modal this wide (it takes 350–500 px). */
export function facebookPostWidth(width: number): number {
  return Math.min(POST_MAX_WIDTH, Math.max(POST_MIN_WIDTH, Math.round(width)));
}

/** The address of Facebook's own player (a video) or post box (a post) for this link, in a modal `width` px wide. */
export function facebookEmbedUrl({ href, video }: FacebookLink, width: number): string {
  const encoded = encodeURIComponent(href);
  if (video) return `https://www.facebook.com/plugins/video.php?href=${encoded}&show_text=false&width=${Math.round(width)}`;
  return `https://www.facebook.com/plugins/post.php?href=${encoded}&show_text=true&width=${facebookPostWidth(width)}`;
}
