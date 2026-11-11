// The security headers (src/lib/securityHeaders.ts, added by next.config.ts): every page and API answer carries them,
// pages still work with the enforced policy, and the report-only policy names every outside service the home page,
// the editor and the view page use (the browser's console would say "Content Security Policy" otherwise).
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Sh", last: "Headers" });
const presentationId = randomUUID();
const browser = await chromium.launch();
try {
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Headers one", data_version: 3 }),
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify({
      presentation_id: presentationId,
      id: "s1",
      position: 0,
      data: {
        id: "s1",
        type: "choice",
        question: "What is 1 + 1?",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: o.toUpperCase() })),
        correctOptionId: null,
        elements: [],
        questionHeight: 100,
      },
    }),
  });

  const context = await loggedIn(browser, teacher);
  const page = await context.newPage();
  const cspMessages = [];
  page.on("console", (message) => {
    if (/Content.Security.Policy|Refused to/i.test(message.text())) cspMessages.push(message.text());
  });

  const response = await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  const headers = response.headers();
  check("home: X-Frame-Options DENY", headers["x-frame-options"] === "DENY", headers["x-frame-options"]);
  check("home: frame-ancestors 'none' enforced", /frame-ancestors 'none'/.test(headers["content-security-policy"] ?? ""));
  check("home: HSTS for a year", /max-age=31536000/.test(headers["strict-transport-security"] ?? ""));
  check("home: nosniff", headers["x-content-type-options"] === "nosniff");
  check("home: the page rendered", (await page.locator("h1, h2").count()) > 0);

  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.getByText("What is 1 + 1?").first().waitFor({ timeout: 60_000 });
  check("editor: the slide is there", true);
  await page.goto(`${APP}/presentation/${presentationId}`, { timeout: 120_000 });
  await page.getByText("What is 1 + 1?").first().waitFor({ timeout: 60_000 });
  check("view page: the slide is there", true);
  await page.goto(`${APP}/account`, { waitUntil: "networkidle" });

  check("no report-only policy messages on home, editor, view page, account", cspMessages.length === 0,
    cspMessages.slice(0, 5).join(" | "));

  const apiResponse = await context.request.get(`${APP}/.well-known/oauth-protected-resource`);
  check("an API route carries the headers too", apiResponse.headers()["x-frame-options"] === "DENY");
  await context.close();
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
