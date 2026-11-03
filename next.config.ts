import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Lets `next dev` reach the Cloudflare bindings in wrangler.jsonc (the live D1 drafts database and R2 bucket).
// The browser tests' server (e2e/dev.mjs) sets QM_E2E=1 to use local copies instead.
const e2e = process.env.QM_E2E === "1";
initOpenNextCloudflareForDev({ remoteBindings: !e2e });

const nextConfig: NextConfig = {
  // The browser tests' server builds in its own folder, so it can run next to `npm run dev`.
  distDir: e2e ? ".next-e2e" : ".next",
  // Old addresses (from before lessons were called presentations) still work, e.g. links Claude
  // already sent (/quiz/new?draft=…; the ?draft= goes along) and bookmarks.
  async redirects() {
    return [
      { source: "/lessons", destination: "/presentations", permanent: true },
      { source: "/lesson/:id", destination: "/presentation/:id", permanent: true },
      { source: "/quiz/new", destination: "/presentation/new", permanent: true },
      { source: "/quiz/:id", destination: "/presentation/:id/edit", permanent: true },
      // The editors' "My reviews" tab is "Reviews & submissions" now.
      { source: "/reviews", destination: "/reviews-submissions", permanent: true },
    ];
  },
};

export default nextConfig;
