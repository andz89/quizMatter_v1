// The proxy (src/proxy.ts): a refreshed login is kept when it sends the page elsewhere (an expired session opening
// /login is refreshed, and the redirect to / carries the new cookies), and only the exact routes Claude calls skip
// it (/api/mcp yes, a route that only starts with that name no).
import { APP, check, deleteTeacher, finish, makeTeacher, sessionCookies } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Proxy" });
try {
  // A session whose access token looks expired: the proxy refreshes it (the refresh token is then used up).
  const pieces = await sessionCookies(teacher, (session) => ({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }));
  const cookie = pieces.map(([name, value]) => `${name}=${value}`).join("; ");
  const res = await fetch(`${APP}/login`, { headers: { cookie }, redirect: "manual" });
  check("a logged-in teacher opening /login is sent to /", res.status === 307 && new URL(res.headers.get("location"), APP).pathname === "/", `${res.status} ${res.headers.get("location")}`);
  const setCookies = res.headers.getSetCookie().filter((c) => c.startsWith("sb-"));
  check("the redirect carries the refreshed login cookies", setCookies.length > 0, `${setCookies.length} cookies`);

  // Logged out: a page goes to /login; Claude's connector answers itself (401); a look-alike route gets the proxy.
  const mcp = await fetch(`${APP}/api/mcp`, { method: "POST", redirect: "manual" });
  check("/api/mcp skips the proxy (its own 401)", mcp.status === 401, `${mcp.status}`);
  const lookAlike = await fetch(`${APP}/api/mcp-admin`, { redirect: "manual" });
  check(
    "/api/mcp-admin doesn't skip the proxy (sent to /login)",
    lookAlike.status === 307 && (lookAlike.headers.get("location") ?? "").includes("/login"),
    `${lookAlike.status} ${lookAlike.headers.get("location")}`,
  );
  const photoLookAlike = await fetch(`${APP}/api/claude-photos`, { redirect: "manual" });
  check(
    "/api/claude-photos doesn't skip the proxy (sent to /login)",
    photoLookAlike.status === 307 && (photoLookAlike.headers.get("location") ?? "").includes("/login"),
    `${photoLookAlike.status} ${photoLookAlike.headers.get("location")}`,
  );
} finally {
  await deleteTeacher(teacher);
}
finish();
