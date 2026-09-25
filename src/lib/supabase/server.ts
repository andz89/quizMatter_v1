import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client for server pages. Make a new one per request — it reads that request's cookies. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server pages can't set cookies. That's fine: the proxy already refreshed the session.
        }
      },
    },
  });
}
