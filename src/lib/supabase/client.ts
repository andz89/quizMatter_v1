import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for the browser. The login session lives in cookies, so the server sees it too. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
