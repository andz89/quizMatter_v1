/**
 * The security headers every response carries (next.config.ts adds them to every path). A `.ts` file with no
 * imports, so `securityHeaders.test.ts` can check it.
 *
 * - X-Frame-Options and `frame-ancestors 'none'`: no other site can put a QuizMatter page in a frame, so nobody can
 *   trick an admin into clicking Ban or Delete through an invisible frame (clickjacking). Our own frames (YouTube,
 *   Facebook, the announcement's sealed box) aren't touched: this is about who may frame *us*.
 * - Strict-Transport-Security: the browser uses https for a year, also for images.quizmatter.com.
 * - X-Content-Type-Options: a file is read as the type we send, never guessed (an uploaded "image" can't run as a script).
 * - Referrer-Policy: a link to another site tells it only "quizmatter.com", not which presentation the teacher was on.
 * - Permissions-Policy: camera, microphone and location are off for the page and every frame in it. Fullscreen is
 *   not named: presenting and YouTube's player need it.
 *
 * The enforced Content-Security-Policy has only directives that can't break a page. The full policy is sent as
 * Content-Security-Policy-Report-Only: the browser only writes to its console what it *would* block, so a new outside
 * service shows up there before anyone enforces it. To enforce it later, Next's own inline scripts need nonces
 * (`'unsafe-inline'` for scripts gives little protection); that's a bigger change.
 */
function reportOnlyPolicy(supabaseUrl: string | undefined): string {
  // The app's own Supabase (the live project, or the local Docker one on the test server: http and ws there).
  let supabase = "https://*.supabase.co wss://*.supabase.co";
  try {
    const origin = new URL(supabaseUrl ?? "").origin;
    supabase = `${origin} ${origin.replace(/^http/, "ws")}`;
  } catch {
    // No or bad address: the fallback above.
  }
  return [
    "default-src 'self'",
    // Next's own inline scripts (`'unsafe-inline'`) and Turnstile. `'unsafe-eval'` only matters for `next dev`.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
    // Slide elements set their colors and sizes inline.
    "style-src 'self' 'unsafe-inline'",
    // Our photos, Supabase, YouTube thumbnails, and an embed image slide's picture from any https site.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} https://challenges.cloudflare.com https://images.quizmatter.com`,
    // `'self'` covers the announcement's sealed box (srcdoc). The rest: Turnstile, embed slides, announcement attachments.
    "frame-src 'self' https://challenges.cloudflare.com https://www.youtube.com https://player.vimeo.com https://docs.google.com https://drive.google.com https://www.canva.com https://www.facebook.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

/** The headers for every response. `supabaseUrl` is `NEXT_PUBLIC_SUPABASE_URL` (the report-only policy allows it). */
export function securityHeaders(supabaseUrl: string | undefined): { key: string; value: string }[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    { key: "Content-Security-Policy-Report-Only", value: reportOnlyPolicy(supabaseUrl) },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
