import { createClient, type User } from "@supabase/supabase-js";

/**
 * Supabase with the secret key, for server code that has no logged-in user (the MCP server, Claude's photo
 * uploads). It skips the database rules, so only use it after checking who's asking. The key only lives on the
 * server (a Cloudflare secret, also used by the photo cleanup). null if it isn't set.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  return key ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } }) : null;
}

/** Every account (Supabase gives them in pages of 1,000). Throws if a page fails. */
export async function listAllUsers(admin: NonNullable<ReturnType<typeof createAdminClient>>) {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}
