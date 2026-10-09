import { createClient } from "@supabase/supabase-js";

// The daily account cleanup, run by Cloudflare on a timer (see worker.ts and "triggers" in wrangler.jsonc).
// It deletes accounts whose email was never confirmed (fake or mistyped sign ups), so they don't pile up.
// A confirmed account is never touched. An unconfirmed one never logged in, so it has no presentations or photos;
// its user_settings row goes with it. A teacher whose link expired can simply sign up again.

type CleanupEnv = {
  SUPABASE_URL: string;
  // Supabase secret key (service role): lets the job list and delete accounts.
  SUPABASE_SECRET_KEY: string;
};

// How long a new account may wait for its email to be confirmed.
const KEEP_UNCONFIRMED_MS = 3 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

export async function cleanupUnconfirmedAccounts(env: CleanupEnv) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const cutoff = Date.now() - KEEP_UNCONFIRMED_MS;

  // Find them all first, then delete: deleting while paging would shift the pages.
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    for (const user of data.users) {
      if (!user.email_confirmed_at && Date.parse(user.created_at) < cutoff) ids.push(user.id);
    }
    if (data.users.length < PAGE_SIZE) break;
  }

  for (const id of ids) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  console.log(`Account cleanup: deleted ${ids.length} unconfirmed accounts.`, ids);
}
