/**
 * The page to go back to after logging in or verifying the second step (`?next=`): only a page on this site, never
 * another domain, and never the verify page itself (that would loop). Anything else means the home page.
 */
export function safeNextPath(next: string | null, origin: string): string {
  if (!next) return "/";
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin || url.pathname === "/login/verify") return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
