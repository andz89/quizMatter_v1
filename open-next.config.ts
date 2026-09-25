import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache (R2): every page is either rendered per request or plain static.
export default defineCloudflareConfig({});
