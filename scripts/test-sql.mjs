import { execSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
// Runs the SQL tests (supabase/tests) on the LOCAL Docker database, never the live one.
//   npm run test:sql                       resets the database (replays every migration), then runs every test
//   npm run test:sql -- maintenance.sql    resets, then runs only the named tests
// A test passes when psql exits cleanly, its output has ROLLBACK, and no FAIL or ERROR.
const container = "supabase_db_quizBuilder"; // supabase_db_ + project_id in supabase/config.toml
const names = process.argv.slice(2).map((name) => name.replace(/^supabase[\\/]tests[\\/]/, ""));
const files = names.length ? names : readdirSync("supabase/tests").filter((name) => name.endsWith(".sql")).sort();

execSync("npx -y supabase@latest db reset", { stdio: "inherit" });

let failed = 0;
for (const name of files) {
  const sql = readFileSync(`supabase/tests/${name}`, "utf8");
  // A file whose first lines say "as supabase_admin" needs that role (e.g. account_delete.sql).
  const asAdmin = /as supabase_admin/.test(sql.split("\n").slice(0, 8).join("\n"));
  const user = asAdmin ? ["-U", "supabase_admin", "-d", "postgres"] : ["-U", "postgres"];
  const result = spawnSync("docker", ["exec", "-i", container, "psql", ...user, "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const passed = result.status === 0 && /\bROLLBACK\b/.test(output) && !/\b(FAIL|ERROR)\b/.test(output);
  console.log(`${passed ? "pass" : "FAIL"}  ${name}`);
  if (!passed) {
    failed++;
    console.log(output.split("\n").slice(-25).join("\n"));
  }
}
console.log(`\n${files.length - failed} of ${files.length} SQL tests passed`);
process.exit(failed ? 1 : 0);
