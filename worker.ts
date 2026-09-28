// The Worker Cloudflare runs. Visitors get the app (built by OpenNext into .open-next/worker.js), as before.
// The timer in wrangler.jsonc ("triggers") runs the weekly photo cleanup. See docs/photo-cleanup.md.

// Made by `opennextjs-cloudflare build`, so it's missing until the app is built. (ts-ignore, not
// ts-expect-error: after a build the file exists, and an unused ts-expect-error is an error too.)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import app from "./.open-next/worker.js";
import type { ExportedHandler } from "@cloudflare/workers-types";
import { cleanupPhotos } from "./src/lib/cleanupPhotos";

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanupPhotos(env));
  },
} satisfies ExportedHandler<CloudflareEnv & Parameters<typeof cleanupPhotos>[0]>;
