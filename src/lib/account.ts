import { cache } from "react";
import { createClient } from "./supabase/server";

export type Account = { id: string; email: string; displayName: string; isAdmin: boolean };

/**
 * The logged-in user: id ("" if logged out), email, display name ("" if not set) and whether they're an admin. Server only.
 * Cached per request, so the top bar and the page share one lookup.
 */
export const getAccount = cache(async (): Promise<Account> => {
  const supabase = await createClient();
  const [{ data: claims }, { data: settings }, { data: isAdmin }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("user_settings").select("display_name").maybeSingle(),
    supabase.rpc("is_admin"),
  ]);
  return {
    id: claims?.claims.sub ?? "",
    email: typeof claims?.claims.email === "string" ? claims.claims.email : "",
    displayName: settings?.display_name ?? "",
    isAdmin: isAdmin === true,
  };
});
