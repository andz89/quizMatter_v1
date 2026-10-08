import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request: refreshes the login session (it expires after a while) and sends
 * logged-out users to /login (except the sign up pages), and logged-in users away from login and sign up. Banned users (Admin → Teachers) aren't checked
 * here, to save a database call on every request: the database refuses their saves and photos at once, and
 * Supabase's own ban ends their login within the hour.
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
  // The link in the "Confirm signup" email: it logs the teacher in, so it must open while logged out.
  const isOpenToAll = isLoginPage || path === "/auth/confirm";

  if (!isLoggedIn && !isOpenToAll) {
    // Remember the page (e.g. a draft link from Claude) so login can come back to it.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  if (isLoggedIn && isLoginPage) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  // Every page, but not Next's own files, images, or what Claude calls without a browser login: the MCP server and
  // its OAuth signpost (the MCP server checks Claude's own login token) and Claude's photo uploads (a one-time link).
  matcher: ["/((?!api/mcp|api/claude-photo|\\.well-known|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
