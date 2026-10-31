import { execSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
// Writes how the LOCAL Docker database looks now (run `npx -y supabase@latest db reset` first):
// supabase/schema.sql (every table, function, trigger and policy) and src/lib/database.types.ts (types for the
// Supabase client). Both are made from the migrations, so commit them with every new migration.
// CI (.github/workflows/database.yml) runs this again and fails if the committed files differ.
const supabase = "npx -y supabase@latest";
const run = (command) => execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });

const tmp = "supabase/.schema.tmp.sql";
run(`${supabase} db dump --local --schema public -f ${tmp}`);
const schema = readFileSync(tmp, "utf8").replace(/\r\n/g, "\n").trim();
rmSync(tmp);
writeFileSync(
  "supabase/schema.sql",
  "-- Made by `npm run db:snapshot` from the migrations. Don't edit it: write a migration, then run the script.\n" +
    "-- Read it to see a function or table as it is now, without hunting for its newest migration.\n\n" +
    schema +
    "\n",
);

const types = run(`${supabase} gen types typescript --local --schema public`).replace(/\r\n/g, "\n").trim();
writeFileSync(
  "src/lib/database.types.ts",
  "// Made by `npm run db:snapshot` from the local database. Don't edit it.\n\n" + types + "\n",
);
console.log("Wrote supabase/schema.sql and src/lib/database.types.ts");
