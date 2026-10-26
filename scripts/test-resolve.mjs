import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Lets tests import app files the way the app does: "./schema" (no ".ts") and "@/lib/schema".
const SRC = new URL("../src/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    let target = specifier;
    if (target.startsWith("@/")) target = new URL(target.slice(2), SRC).href;
    if (target.startsWith(".") || target.startsWith("file:")) {
      const base = new URL(target, context.parentURL);
      for (const ext of ["", ".ts", "/index.ts"]) {
        const candidate = new URL(base.href + ext);
        if (ext !== "" || /\.[cm]?[jt]sx?$/.test(base.pathname)) {
          if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
        }
      }
    }
    return next(specifier, context);
  },
});
