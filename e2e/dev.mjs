// Starts the app for the browser tests (`npm run e2e:dev`): http://localhost:3100, on the LOCAL Docker Supabase and
// local copies of the D1 drafts database and the R2 photos bucket (QM_E2E=1, see next.config.ts). The keys here win
// over the live ones in .env.local. It builds in .next-e2e, so `npm run dev` can keep running next to it.
import { execSync, spawn } from "node:child_process";
import { env } from "./lib.mjs";

execSync("npx wrangler d1 migrations apply DRAFTS_DB --local", { stdio: "inherit" });

spawn("npx next dev -p 3100", {
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    QM_E2E: "1",
    NEXT_PUBLIC_SUPABASE_URL: env.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY,
    SUPABASE_SECRET_KEY: env.SECRET_KEY,
  },
});
