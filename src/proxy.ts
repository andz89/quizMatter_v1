import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getMaintenanceStatus, MAINTENANCE_HEADER, MAINTENANCE_WORDS } from "@/lib/maintenance";

/**
 * Runs before every page request: refreshes the login session (it expires after a while) and sends
 * logged-out users to /login (except the sign up, Privacy and Terms pages), and logged-in users away from login and sign up. Banned users (Admin → Teachers) aren't checked
 * here, to save a database call on every request: the database refuses their saves and photos at once, and
 * Supabase's own ban ends their login within the hour.
 * Maintenance (Admin → Maintenance): everyone but the super admin is stopped here (see maintenanceAnswer). The
 * status is remembered for 60 seconds (src/lib/maintenance.ts), so this isn't a database call per request.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        // The refreshed session goes on the request (for the page about to render) and the response (for the browser).
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);
  const path = request.nextUrl.pathname;
  const isLoginPage = path === "/login" || path === "/signup";
  // The link in the "Confirm signup" email: it logs the teacher in, so it must open while logged out. Privacy and
  // Terms (the footer's links) can be read before making an account.
  const isOpenToAll = isLoginPage || path === "/auth/confirm" || path === "/privacy" || path === "/terms";

  const maintenance = await getMaintenanceStatus();
  if (maintenance.isOn) {
    // Login stays open so the super admin can get in (the login page logs anyone else out again).
    const isOpenDuringMaintenance = path === "/maintenance" || path === "/login" || path === "/privacy" || path === "/terms";
    if (!isOpenDuringMaintenance) {
      // Asked only during maintenance (the database guard lets the super admin's call through, and refuses others').
      const isSuperAdmin = isLoggedIn && (await supabase.rpc("is_super_admin")).data === true;
      if (!isSuperAdmin) return maintenanceAnswer(request);
    }
    // Opens without a login too.
    if (path === "/maintenance") return response;
  } else if (path === "/maintenance") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isLoggedIn && !isOpenToAll) {
    // Remember the page (e.g. a draft link from Claude) so login can come back to it.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  if (isLoggedIn && isLoginPage) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

/**
 * What a stopped request gets during maintenance. Opening a page (and an in-app page load: Next's router follows
 * the redirect by itself) goes to /maintenance. A server action or /api/* gets 503 with the maintenance header
 * instead: src/components/MaintenanceWatch.tsx sees it and sends the tab to /maintenance (a redirect would only
 * confuse the page's own fetch).
 */
function maintenanceAnswer(request: NextRequest) {
  const isPageOpen = request.method === "GET" && !request.headers.has("next-action") && !request.nextUrl.pathname.startsWith("/api/");
  if (isPageOpen) return NextResponse.redirect(new URL("/maintenance", request.url));
  return NextResponse.json(
    { error: MAINTENANCE_WORDS },
    { status: 503, headers: { [MAINTENANCE_HEADER]: "1", "Retry-After": "600" } },
  );
}

export const config = {
  // Every page, but not Next's own files, the real static files (the icon files and what is in public/), or what
  // Claude calls without a browser login: the MCP server and its OAuth signpost (the MCP server checks Claude's own
  // login token) and Claude's photo uploads (a one-time link). A page address that only ends in ".png" still gets
  // the login check. Add a new file in public/ here too.
  matcher: [
    "/((?!api/mcp|api/claude-photo|\\.well-known|_next/static|_next/image|favicon\\.ico$|icon\\.svg$|(?:file|globe|next|vercel|window)\\.svg$).*)",
  ],
};
