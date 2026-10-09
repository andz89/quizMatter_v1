import { createClient } from "@supabase/supabase-js";

// The daily account cleanup, run by Cloudflare on a timer (see worker.ts and "triggers" in wrangler.jsonc).
// It deletes accounts whose email was never confirmed (fake or mistyped sign ups), so they don't pile up.
// A confirmed account is never touched. An unconfirmed one never logged in, so it has no presentations or photos;
// its user_settings row goes with it. A teacher whose link expired can simply sign up again. Accounts an admin
// invited from the Supabase dashboard are kept, even when not accepted yet.
// It also empties old rows of sign_up_attempts (the sign up limit per internet address, 20261108000000_sign_up_limit.sql).

type CleanupEnv = {
  SUPABASE_URL: string;
  // Supabase secret key (service role): lets the job list and delete accounts.
  SUPABASE_SECRET_KEY: string;
};

// How long a new account may wait for its email to be confirmed (Admin → Safety shows it).
export const KEEP_UNCONFIRMED_DAYS = 3;
const KEEP_UNCONFIRMED_MS = KEEP_UNCONFIRMED_DAYS * 24 * 60 * 60 * 1000;
// The sign up limit only looks at the last hour, so a day is plenty.
const KEEP_SIGN_UP_ATTEMPTS_MS = 24 * 60 * 60 * 1000;
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
      if (!user.email_confirmed_at && !user.invited_at && Date.parse(user.created_at) < cutoff) ids.push(user.id);
    }
    if (data.users.length < PAGE_SIZE) break;
  }

  // One account that can't be deleted mustn't stop the others (or the rest of the cleanup), every day.
  const failed: string[] = [];
  for (const id of ids) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) {
      console.error(`Account cleanup: couldn't delete ${id}.`, error);
      failed.push(id);
    }
  }
  console.log(`Account cleanup: deleted ${ids.length - failed.length} unconfirmed accounts.`, ids);

  const { error } = await supabase
    .from("sign_up_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - KEEP_SIGN_UP_ATTEMPTS_MS).toISOString());
  if (error) throw error;
}
