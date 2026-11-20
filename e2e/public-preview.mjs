// The public preview of a published presentation (docs/superpowers/specs/2026-11-20-public-presentation-preview-design.md).
// Logged out: a published one shows its preview (the first shown slide, the title as the h1, the login and sign up
// buttons) with the link-preview tags and a PNG title card; a private one and one QuizMatter hid go to login, as
// before. Logged in: the same link is the normal view page.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { APP, SHOTS, asUser, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Preview", last: "Maker" });
const viewer = await makeTeacher({ first: "Preview", last: "Viewer" });
const admin = await makeTeacher({ first: "Preview", last: "Admin", admin: true });
const browser = await chromium.launch();

const slide = (id, question, hidden = false) => ({
  id,
  type: "choice",
  question,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((option) => ({ id: `${id}-${option}`, text: `Choice ${option.toUpperCase()}` })),
  correctOptionId: `${id}-b`,
  elements: [],
  questionHeight: 100,
  ...(hidden ? { hidden: true } : {}),
});

const videoSlide = { ...slide("v1", ""), type: "video", embedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", correctOptionId: null };

// A teacher's published presentation is a shared copy of a private original; its rows go in with the sharing setting.
const ids = {
  original: crypto.randomUUID(), copy: crypto.randomUUID(), hiddenOriginal: crypto.randomUUID(), hidden: crypto.randomUUID(),
  private: crypto.randomUUID(), videoOriginal: crypto.randomUUID(), video: crypto.randomUUID(),
};
// Long, with ñ: the title card must draw it and cut it at 3 lines.
const title = "Mga Bahagi ng Pangungusap: Ang Simuno at Panaguri sa Bawat Pangungusap na Isinulat ni Niño sa Kanyang Kuwaderno";
psql(`
  insert into public.presentations (id, owner_id, title) values
    ('${ids.original}', '${teacher.id}', 'Original'),
    ('${ids.hiddenOriginal}', '${teacher.id}', 'Hidden original'),
    ('${ids.private}', '${teacher.id}', 'Private one'),
    ('${ids.videoOriginal}', '${teacher.id}', 'Video original');
  select set_config('quizmatter.sharing', 'yes', false);
  -- The copy has an Author; the video one has none (so no name may show: never the display name).
  insert into public.presentations (id, owner_id, title, description, subject, grades, author, shared_from, is_published, shared_at) values
    ('${ids.copy}', '${teacher.id}', '${title}', 'Simuno at panaguri.', 'Filipino', '{"Grade 4"}', 'Gng. Santos', '${ids.original}', true, now()),
    ('${ids.hidden}', '${teacher.id}', 'Hidden copy', '', '', '{}', '', '${ids.hiddenOriginal}', true, now()),
    ('${ids.video}', '${teacher.id}', 'Video lesson', '', '', '{}', '', '${ids.videoOriginal}', true, now());
  insert into public.slides (presentation_id, id, position, data) values
    ('${ids.copy}', 's1', 0, $j$${JSON.stringify(slide("s1", "Secret first slide", true))}$j$),
    ('${ids.copy}', 's2', 1, $j$${JSON.stringify(slide("s2", "Ano ang simuno?"))}$j$),
    ('${ids.hidden}', 'h1', 0, $j$${JSON.stringify(slide("h1", "Hidden"))}$j$),
    ('${ids.private}', 'p1', 0, $j$${JSON.stringify(slide("p1", "Private"))}$j$),
    ('${ids.video}', 'v1', 0, $j$${JSON.stringify(videoSlide)}$j$);
`);
// QuizMatter hides one (as Admin → Reports does).
const hide = await asUser(admin, `/rest/v1/presentations?id=eq.${ids.hidden}`, {
  method: "PATCH",
  body: JSON.stringify({ hidden_at: new Date().toISOString() }),
});
check("setup: the admin hid one", hide.ok, `${hide.status} ${JSON.stringify(hide.body)}`);

try {
  // ─── Logged out ─────────────────────────────────────────────────────────────────────────────────────────────
  const visitor = await browser.newContext();
  // Every address the visitor's browser asks for (YouTube must never see a logged-out visitor).
  const asked = [];
  visitor.on("request", (request) => asked.push(request.url()));
  const page = await visitor.newPage();
  await page.goto(`${APP}/presentation/${ids.copy}`);
  // The page streams (a loading screen first), so wait for its content.
  await page.locator("h1").waitFor();
  await page.getByText("Ano ang simuno?").waitFor({ timeout: 10_000 }).catch(() => {});
  check("logged out, a published presentation opens its preview", new URL(page.url()).pathname === `/presentation/${ids.copy}`, page.url());
  check("its h1 is the title", (await page.locator("h1").innerText()) === title, await page.locator("h1").innerText().catch(() => ""));
  check("it shows the first shown slide", await page.getByText("Ano ang simuno?").isVisible());
  check("the hidden first slide isn't shown", (await page.getByText("Secret first slide").count()) === 0);
  check("it names the Author", await page.getByText("By Gng. Santos").isVisible());
  // No answer in what the page sends (the database leaves it out; the answer's id would be "s2-b").
  const answerInPage = new RegExp('correctOptionId\\\\?"\\s*:\\s*\\\\?"s2-b');
  check("the first slide's answer isn't in the page", !answerInPage.test(await page.content()));
  await page.screenshot({ path: `${SHOTS}public-preview.png`, fullPage: true });
  check("the details line counts shown slides", await page.getByText("Filipino · Grade 4 · 1 slide").isVisible());
  const login = page.getByRole("link", { name: "Log in to see the slide" });
  check("the main button goes to login and back", (await login.getAttribute("href")) === `/login?next=${encodeURIComponent(`/presentation/${ids.copy}`)}`, await login.getAttribute("href"));
  check("there's a sign up button", (await page.getByRole("link", { name: "Sign up free" }).getAttribute("href")) === "/signup");

  const meta = (selector) => page.locator(selector).first().getAttribute("content");
  check("og:title is the title", (await meta('meta[property="og:title"]')) === title, await meta('meta[property="og:title"]'));
  check("the description is its own", (await meta('meta[name="description"]')) === "Simuno at panaguri.", await meta('meta[name="description"]'));
  check("twitter:card is a large picture", (await meta('meta[name="twitter:card"]')) === "summary_large_image", await meta('meta[name="twitter:card"]'));
  const image = await meta('meta[property="og:image"]');
  // A full address. In `next dev` Next writes the local server's own (http://localhost:3100); a production build
  // writes metadataBase's https://quizmatter.com (checked on the Workers build).
  check("og:image is a full address", /^https?:\/\//.test(image ?? ""), image);
  const imageUrl = new URL(image);
  const picture = await fetch(`${APP}${imageUrl.pathname}${imageUrl.search}`);
  check("its picture is a PNG, logged out", picture.status === 200 && picture.headers.get("content-type") === "image/png", `${picture.status} ${picture.headers.get("content-type")}`);
  writeFileSync(`${SHOTS}public-preview-card.png`, Buffer.from(await picture.arrayBuffer()));

  const unknownPicture = await fetch(`${APP}/presentation/${crypto.randomUUID()}/opengraph-image`);
  check("an unknown presentation's picture is 404, not drawn", unknownPicture.status === 404, `${unknownPicture.status}`);

  // No Author: no name at all (a display name is usually a teacher's full name). A video slide shows its plain box.
  await page.goto(`${APP}/presentation/${ids.video}`);
  await page.locator("h1").waitFor();
  await page.getByText("YouTube").first().waitFor({ timeout: 10_000 }).catch(() => {});
  const mainText = await page.locator("main").innerText();
  check("with no Author, no name shows", !mainText.includes("By ") && !mainText.includes("Preview Maker"), mainText.slice(0, 200));
  check("the video slide names YouTube", await page.getByText("YouTube").first().isVisible());
  const youTubeAsked = asked.filter((url) => /ytimg\.com|youtube\.com/.test(url));
  check("YouTube is never asked", youTubeAsked.length === 0, youTubeAsked.join(" "));

  for (const [name, id] of [["a private presentation", ids.private], ["one QuizMatter hid", ids.hidden], ["an unknown one", crypto.randomUUID()]]) {
    await page.goto(`${APP}/presentation/${id}`);
    // The page streams, so the redirect can happen in the browser once it arrives.
    await page.waitForURL(/\/login/, { timeout: 10_000 }).catch(() => {});
    const url = new URL(page.url());
    check(`logged out, ${name} goes to login`, url.pathname === "/login" && url.searchParams.get("next") === `/presentation/${id}`, page.url());
  }
  await visitor.close();

  // ─── Logged in: the normal view page ────────────────────────────────────────────────────────────────────────
  const context = await loggedIn(browser, viewer);
  const viewerPage = await context.newPage();
  await viewerPage.goto(`${APP}/presentation/${ids.copy}`);
  check("logged in, it's the normal view page (Make a copy)", await viewerPage.getByRole("button", { name: "Make a copy" }).isVisible());
  check("logged in, no login buttons", (await viewerPage.getByRole("link", { name: "Log in to see the slide" }).count()) === 0);
  await context.close();
} finally {
  await browser.close();
  await deleteTeacher(teacher);
  await deleteTeacher(viewer);
  await deleteTeacher(admin);
}
finish();
