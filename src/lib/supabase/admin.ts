import { createClient } from "@supabase/supabase-js";

/**
 * Supabase with the secret key, for server code that has no logged-in user (the MCP server, Claude's photo
 * uploads). It skips the database rules, so only use it after checking who's asking. The key only lives on the
 * server (a Cloudflare secret, also used by the photo cleanup). null if it isn't set.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  return key ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } }) : null;
}
