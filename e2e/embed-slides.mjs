// Embed slides: add an Embed video and an Embed slides slide in the editor, paste their links (a bad link is refused),
// save, reload, then present fullscreen: only the slide being shown plays its live embed.
// YouTube and Google Slides are answered with small stand-in pages, so the test needs neither site.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher, round } from "./lib.mjs";

const VIDEO_ID = "dQw4w9WgXcQ";
const VIDEO_LINK = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const VIDEO_SRC = `https://www.youtube.com/embed/${VIDEO_ID}`;
const DECK_ID = "e2eDeck-123";
const DECK_LINK = `https://docs.google.com/presentation/d/${DECK_ID}/edit?usp=sharing`;
const DECK_SRC = `https://docs.google.com/presentation/d/${DECK_ID}/embed?start=false&loop=false`;
const VIDEO_STAND_IN = "Stand-in video player";
const DECK_STAND_IN = "Stand-in slide deck";

// A teacher and a presentation with one question slide; the embed slides are made in the editor.
const teacher = await makeTeacher({ first: "Embed" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Embed slides e2e", data_version: 3 }),
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
      question: "Intro",
      layout: "grid",
      options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: o.toUpperCase() })),
      correctOptionId: null,
      elements: [],
      questionHeight: 100,
    },
  }),
});

/** The saved slides, in order, straight from the local database. */
const savedSlides = () => api(`/rest/v1/slides?presentation_id=eq.${presentationId}&select=id,position,data&order=position`);

const browser = await chromium.launch();
const context = await loggedIn(browser, teacher, { width: 1600, height: 1000 });
const standIn = (text) => (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><h1>${text}</h1>` });
await context.route("https://www.youtube.com/embed/**", standIn(VIDEO_STAND_IN));
await context.route("https://docs.google.com/presentation/**", standIn(DECK_STAND_IN));
await context.route("https://i.ytimg.com/**", (route) => route.abort());
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const slideIds = () =>
  page.locator("[data-slide-id]").evaluateAll((boxes) => [...new Set(boxes.map((box) => box.dataset.slideId))]);
const slideBox = (id) => page.locator(`[data-slide-id="${id}"]`);

/** Adds a slide from the workspace's Add slide menu and returns the new slide's id. */
async function addSlide(label) {
  const before = await slideIds();
  const button = page.locator('button[title="Add slide"]');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.getByRole("button", { name: label, exact: true }).click();
  for (let i = 0; i < 40; i++) {
    const added = (await slideIds()).find((id) => !before.includes(id));
    if (added) return added;
    await page.waitForTimeout(250);
  }
  throw new Error(`"${label}" added no slide`);
}

// The presenting screen, and the layer of the slide being shown.
const screen = page.locator(".fixed.inset-0.z-50").filter({ has: page.locator('button[title="Exit presentation (Esc)"]') });
const shownEmbed = screen.locator('[aria-hidden="false"] iframe');
const isFullscreen = () => page.evaluate(() => document.fullscreenElement !== null);

/** The next effect's slide has ended when the shown slide's player is in the page. */
async function expectShown(name, src, text) {
  await shownEmbed.waitFor();
  check(`${name}: the live embed has the right address`, (await shownEmbed.getAttribute("src")) === src);
  check(`${name}: only the slide being shown plays`, (await screen.locator("iframe").count()) === 1);
  await screen.frameLocator('[aria-hidden="false"] iframe').getByText(text).waitFor();
  check(`${name}: the player loads inside the slide`, true);
  const box = await shownEmbed.boundingBox();
  check(`${name}: the player fills most of the screen`, box !== null && box.width > 1200 && box.height > 700, round(box));
}

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await slideBox("s1").waitFor();

  // Embed video: a bad link is refused, a YouTube link becomes the player.
  const videoId = await addSlide("Embed video");
  const video = slideBox(videoId);
  await video.getByPlaceholder("Paste a YouTube, Vimeo or Canva link").fill("https://example.com/not-a-video");
  await video.getByRole("button", { name: "Add video", exact: true }).click();
  await video.getByText("Paste a YouTube, Vimeo or Canva video link.").waitFor();
  check("Embed video: a link from another site is refused", (await video.locator("iframe").count()) === 0);
  await video.getByPlaceholder("Paste a YouTube, Vimeo or Canva link").fill(VIDEO_LINK);
  await video.getByRole("button", { name: "Add video", exact: true }).click();
  await video.locator("iframe").waitFor();
  check("Embed video: a YouTube link becomes the player", (await video.locator("iframe").getAttribute("src")) === VIDEO_SRC);

  // Embed slides: a Google Slides share link becomes the deck viewer.
  const deckId = await addSlide("Embed slides");
  const deck = slideBox(deckId);
  await deck.getByPlaceholder("Paste a Google Slides or Canva link").fill(DECK_LINK);
  await deck.getByRole("button", { name: "Add slides", exact: true }).click();
  await deck.locator("iframe").waitFor();
  check("Embed slides: a Google Slides link becomes the viewer", (await deck.locator("iframe").getAttribute("src")) === DECK_SRC);
  await page.screenshot({ path: SHOTS + "embed-slides-editor.png" });

  // Save with the Save button: the toast, then the database.
  await page.locator('button[title="Save (Ctrl+S)"]').click();
  await page.getByText("Presentation saved.", { exact: true }).waitFor();
  check('saving shows "Presentation saved."', true);
  const saved = await savedSlides();
  check("saved: 3 slides, in order", saved.map((s) => s.id).join() === ["s1", videoId, deckId].join(), saved.map((s) => s.id).join());
  check("saved: the video slide has its type and link", saved[1]?.data.type === "video" && saved[1]?.data.embedUrl?.includes(VIDEO_ID), saved[1]?.data.embedUrl);
  check("saved: the deck slide has its type and link", saved[2]?.data.type === "embed-slides" && saved[2]?.data.embedUrl?.includes(DECK_ID), saved[2]?.data.embedUrl);

  // Reload: both come back from the save.
  await page.reload({ timeout: 120_000 });
  await slideBox(deckId).locator("iframe").waitFor();
  check("after reload: the video is still there", (await slideBox(videoId).locator("iframe").getAttribute("src")) === VIDEO_SRC);
  check("after reload: the deck is still there", (await slideBox(deckId).locator("iframe").getAttribute("src")) === DECK_SRC);

  // Present fullscreen from the first slide.
  await slideBox("s1").scrollIntoViewIfNeeded();
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  await screen.locator('[aria-hidden="false"]').filter({ hasText: "Intro" }).waitFor();
  check("presenting starts on the first slide", true);
  check("presenting is really fullscreen", await isFullscreen());
  check("a question slide plays no embed", (await screen.locator("iframe").count()) === 0);

  // On an ordinary slide the buttons hide when the mouse is still.
  const exitButton = page.locator('button[title="Exit presentation (Esc)"]');
  const buttonsAreOff = () => exitButton.evaluate((button) => getComputedStyle(button.parentElement).pointerEvents === "none");
  await page.waitForFunction(() => getComputedStyle(document.querySelector('button[title="Exit presentation (Esc)"]').parentElement).pointerEvents === "none");
  check("a question slide: the buttons hide when the mouse is still", await buttonsAreOff());

  await page.keyboard.press("ArrowRight");
  await expectShown("video slide", VIDEO_SRC, VIDEO_STAND_IN);
  await page.screenshot({ path: SHOTS + "embed-slides-present-video.png" });

  await page.keyboard.press("ArrowRight");
  await expectShown("deck slide", DECK_SRC, DECK_STAND_IN);
  await page.screenshot({ path: SHOTS + "embed-slides-present-deck.png" });

  await page.keyboard.press("ArrowLeft");
  await expectShown("back on the video slide", VIDEO_SRC, VIDEO_STAND_IN);

  // On a live player the buttons stay: a mouse moving over it never reaches the page (it's another site's frame), so
  // they could never come back. The mouse hasn't moved since the question slide, when they were hidden.
  check("a live player: the buttons show without moving the mouse", !(await buttonsAreOff()));
  await page.waitForTimeout(3500);
  check("a live player: the buttons stay when the mouse is still", !(await buttonsAreOff()));

  // Back on an ordinary slide they hide again.
  await page.keyboard.press("ArrowLeft");
  await screen.locator('[aria-hidden="false"]').filter({ hasText: "Intro" }).waitFor();
  await page.waitForTimeout(300);
  check("back on the question slide: the buttons hide again", await buttonsAreOff());
  await page.keyboard.press("ArrowRight");
  await shownEmbed.waitFor();

  // Next.js's dev badge sits on top of the Exit button (development only).
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await exitButton.click({ timeout: 10_000 });
  await screen.waitFor({ state: "detached" });
  check("Exit ends the presentation", true);
  await page.waitForFunction(() => document.fullscreenElement === null);
  check("Exit leaves fullscreen", true);
  await slideBox(deckId).waitFor();
  check("the editor is back with its slides", (await slideIds()).length === 3);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 14).join(" "));
  await page.screenshot({ path: SHOTS + "embed-slides-failure.png" }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
