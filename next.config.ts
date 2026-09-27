import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Lets `next dev` reach the Cloudflare bindings in wrangler.jsonc (a local copy of the D1 drafts database).
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // Old addresses (from before lessons were called presentations) still work, e.g. links Claude
  // already sent (/quiz/new?draft=…; the ?draft= goes along) and bookmarks.
  async redirects() {
    return [
      { source: "/lessons", destination: "/presentations", permanent: true },
      { source: "/lesson/:id", destination: "/presentation/:id", permanent: true },
      { source: "/quiz/new", destination: "/presentation/new", permanent: true },
      { source: "/quiz/:id", destination: "/presentation/:id/edit", permanent: true },
    ];
  },
};

export default nextConfig;
