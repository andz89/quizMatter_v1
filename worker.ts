// The Worker Cloudflare runs. Visitors get the app (built by OpenNext into .open-next/worker.js), as before.
// The timers in wrangler.jsonc ("triggers") run the weekly photo cleanup (see docs/photo-cleanup.md) and the daily
// cleanup of accounts that were never confirmed, of safety records older than a year, and of who closed an
// announcement that ended over 30 days ago (src/lib/cleanupAccounts.ts).
// Both wait during maintenance (Admin → Maintenance), so nothing is deleted while data is being fixed; if the status
// can't be read they wait too. They run again at their next time.

// Made by `opennextjs-cloudflare build`, so it's missing until the app is built. (ts-ignore, not
// ts-expect-error: after a build the file exists, and an unused ts-expect-error is an error too.)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import app from "./.open-next/worker.js";
import type { ExportedHandler } from "@cloudflare/workers-types";
import { cleanupUnconfirmedAccounts } from "./src/lib/cleanupAccounts";
import { cleanupPhotos } from "./src/lib/cleanupPhotos";
import { fetchMaintenanceStatus } from "./src/lib/maintenance";

// Must match "crons" in wrangler.jsonc.
const PHOTO_CLEANUP_CRON = "0 3 * * SUN";
const ACCOUNT_CLEANUP_CRON = "0 4 * * *";

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    const maintenance = await fetchMaintenanceStatus(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
    if (maintenance?.isOn !== false) {
      console.log("Cleanup skipped: maintenance is on, or its status couldn't be read.");
      return;
    }
    if (event.cron === PHOTO_CLEANUP_CRON) ctx.waitUntil(cleanupPhotos(env));
    if (event.cron === ACCOUNT_CLEANUP_CRON) ctx.waitUntil(cleanupUnconfirmedAccounts(env));
  },
} satisfies ExportedHandler<CloudflareEnv & Parameters<typeof cleanupPhotos>[0]>;
