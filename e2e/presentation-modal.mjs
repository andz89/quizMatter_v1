// The presentation modal (docs/superpowers/specs/2026-11-25-presentation-modal-design.md). Logged in, a card of
// someone else's presentation opens a Canva-style modal over the list; the address never changes, so Back, Escape and
// ✕ close it and a reload just reloads the list. "Show more like this" loads cards inside it, and one of them swaps
// the modal. Escape in the Report box closes only that box. A link to /presentation/<id> is the full page, same layout.
// Saving in the modal updates the card behind at once; over the full page only the modal hears the arrow keys and
// shows Present; Back while presenting ends it; leaving through Make a copy needs one Back to return. Opening one
// again shows the remembered copy without asking the server.
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const admin = await makeTeacher({ first: "Modal", last: "Admin", admin: true });
const viewer = await makeTeacher({ first: "Modal", last: "Viewer" });
const browser = await chromium.launch();

const slide = (id, question) => ({
  id,
  type: "choice",
  question,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((option) => ({ id: `${id}-${option}`, text: `Choice ${option.toUpperCase()}` })),
  correctOptionId: `${id}-b`,
  elements: [],
  questionHeight: 100,
});

const tag = Date.now();
const ids = { a: crypto.randomUUID(), b: crypto.randomUUID() };
const titles = { a: `Modal lesson A ${tag}`, b: `Modal lesson B ${tag}` };
psql(`
  insert into public.presentations (id, owner_id, title, description, subject, grades, tags, is_published, from_admin) values
    ('${ids.a}', '${admin.id}', '${titles.a}', 'All about plants.', 'Science', '{"Grade 3"}', '{"plants","leaves"}', true, true),
    ('${ids.b}', '${admin.id}', '${titles.b}', '', 'Science', '{"Grade 3"}', '{}', true, true);
  insert into public.slides (presentation_id, id, position, data) values
    ('${ids.a}', 'a1', 0, $j$${JSON.stringify(slide("a1", "First question A"))}$j$),
    ('${ids.a}', 'a2', 1, $j$${JSON.stringify(slide("a2", "Second question A"))}$j$),
    ('${ids.a}', 'a3', 2, $j$${JSON.stringify(slide("a3", "Third question A"))}$j$),
    ('${ids.b}', 'b1', 0, $j$${JSON.stringify(slide("b1", "First question B"))}$j$),
    ('${ids.b}', 'b2', 1, $j$${JSON.stringify(slide("b2", "Second question B"))}$j$),
    ('${ids.b}', 'b3', 2, $j$${JSON.stringify(slide("b3", "Third question B"))}$j$);
`);

try {
  const context = await loggedIn(browser, viewer, { width: 1440, height: 900 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  const page = await context.newPage();
  const dialog = page.getByRole("dialog", { name: titles.a });
  const anyDialog = page.locator('[role="dialog"]');
  const openA = async () => {
    await page.locator("a", { hasText: titles.a }).first().click();
    await dialog.waitFor({ timeout: 20_000 });
    await dialog.getByRole("heading", { name: titles.a }).waitFor();
  };

  await page.goto(`${APP}/quizmatter`);
  await page.locator("a", { hasText: titles.a }).first().waitFor({ timeout: 30_000 });
  const pages = context.pages().length;
  await openA();
  check("a card opens the modal", await dialog.isVisible());
  check("in the same tab (no new tab)", context.pages().length === pages, `${context.pages().length}`);
  check("the address doesn't change", new URL(page.url()).pathname === "/quizmatter", page.url());
  check("it shows the first slide", await dialog.getByText("First question A").first().isVisible());
  check("tags show", await dialog.getByText("leaves", { exact: true }).isVisible());
  check("Make a copy is the main button", await dialog.getByRole("button", { name: "Make a copy" }).isVisible());
  await page.screenshot({ path: `${SHOTS}presentation-modal.png` });

  await dialog.getByRole("button", { name: "Slide 2" }).click();
  check("a slide in the strip shows big", await dialog.getByText("2 / 3").isVisible());
  await page.keyboard.press("ArrowRight");
  check("→ goes to the next slide", await dialog.getByText("3 / 3").isVisible());

  // Report: Escape closes only the report box.
  await dialog.getByRole("button", { name: "Report" }).click();
  await page.getByRole("dialog", { name: "Report this presentation" }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape in Report closes only that box", (await anyDialog.count()) === 1 && (await dialog.isVisible()), `${await anyDialog.count()}`);

  // Share copies the link.
  await dialog.getByRole("button", { name: "Share" }).click();
  await page.getByText("Link copied.").waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check("Share copies the presentation's link", copied.endsWith(`/presentation/${ids.a}`), copied);

  // More like this, then a card there swaps the modal.
  await dialog.getByRole("button", { name: "Show more like this" }).click();
  const suggestion = dialog.locator("a", { hasText: titles.b }).first();
  await suggestion.waitFor({ timeout: 20_000 });
  check("Show more like this loads cards inside the modal", await suggestion.isVisible());
  await suggestion.click();
  const dialogB = page.getByRole("dialog", { name: titles.b });
  await dialogB.getByRole("heading", { name: titles.b }).waitFor({ timeout: 20_000 });
  check("a card in it swaps the modal", (await anyDialog.count()) === 1, `${await anyDialog.count()}`);

  await page.keyboard.press("Escape");
  await anyDialog.first().waitFor({ state: "detached" });
  check("Escape closes it, back on the list", new URL(page.url()).pathname === "/quizmatter", page.url());

  // Opening one again within 5 minutes shows the remembered copy: no request to the server.
  let serverCalls = 0;
  const countCalls = (request) => {
    if (request.headers()["next-action"]) serverCalls++;
  };
  page.on("request", countCalls);
  await openA();
  page.off("request", countCalls);
  check("opening it again sends no request", serverCalls === 0, `${serverCalls}`);

  // Back closes it too, and stays on the list.
  await page.goBack();
  await anyDialog.first().waitFor({ state: "detached" });
  check("Back closes it and stays on the list", new URL(page.url()).pathname === "/quizmatter", page.url());

  // A double-click on a card: the second click lands outside the loading box, and the modal stays.
  await page.locator("a", { hasText: titles.a }).first().dblclick();
  await dialog.getByRole("heading", { name: titles.a }).waitFor({ timeout: 20_000 });
  check("a double-click keeps the modal open", await dialog.isVisible());

  // Escape, then another card at once (before the browser's Back is done): the new modal stays.
  await page.keyboard.press("Escape");
  await page.locator("a", { hasText: titles.b }).first().click();
  const quickB = page.getByRole("dialog", { name: titles.b });
  await quickB.getByRole("heading", { name: titles.b }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  check("closing and opening another card at once keeps the new one", await quickB.isVisible());
  await page.goBack();
  await anyDialog.first().waitFor({ state: "detached" });
  check("…and one Back still closes it, on the list", new URL(page.url()).pathname === "/quizmatter", page.url());

  // A reload just reloads the list.
  await openA();
  await page.reload();
  await page.locator("a", { hasText: titles.a }).first().waitFor({ timeout: 30_000 });
  check("a reload shows the list without the modal", (await anyDialog.count()) === 0 && new URL(page.url()).pathname === "/quizmatter", page.url());

  // Save inside the modal, then ✕: the Saved tab has it.
  await openA();
  await dialog.getByRole("button", { name: "Save to your home page" }).click();
  await page.getByText("Saved. Find it").waitFor();
  check(
    "the card behind shows it saved at once",
    (await page.getByRole("button", { name: `Remove ${titles.a} from Saved` }).count()) >= 1,
  );
  await dialog.getByRole("button", { name: "Close" }).click();
  await anyDialog.first().waitFor({ state: "detached" });
  await page.goto(`${APP}/saved`);
  check("Save in the modal works", await page.locator("a", { hasText: titles.a }).first().isVisible({ timeout: 20_000 }));

  // On Saved: remove it in the modal, then save it again: the card behind comes back.
  await openA();
  await dialog.getByRole("button", { name: "Remove from Saved" }).click();
  await page.getByText("Removed from Saved.").waitFor();
  await dialog.getByRole("button", { name: "Save to your home page" }).click();
  await page.getByText("Saved. Find it").waitFor();
  await dialog.getByRole("button", { name: "Close" }).click();
  await anyDialog.first().waitFor({ state: "detached" });
  await page.waitForTimeout(1_000);
  check("removed then saved again: the Saved card stays", (await page.locator("a", { hasText: titles.a }).count()) >= 1);

  // The full page: a link to it (shared link, reload of the page itself).
  await page.goto(`${APP}/presentation/${ids.a}`);
  await page.locator("h1", { hasText: titles.a }).waitFor({ timeout: 20_000 });
  check("a link opens the full page, no modal", (await anyDialog.count()) === 0);
  check("the full page has the same layout", await page.getByRole("button", { name: "Show more like this" }).isVisible());
  await page.getByText("First question A").first().waitFor({ timeout: 20_000 });
  check("the full page draws the slide", await page.getByText("First question A").first().isVisible());
  await page.screenshot({ path: `${SHOTS}presentation-page.png` });

  // The modal over the full page: only the modal hears the arrow keys, and Present shows one view.
  await page.getByRole("button", { name: "Show more like this" }).click();
  await page.locator("main a", { hasText: titles.b }).first().click({ timeout: 20_000 });
  const dialogOverPage = page.getByRole("dialog", { name: titles.b });
  await dialogOverPage.getByRole("heading", { name: titles.b }).waitFor({ timeout: 20_000 });
  await page.keyboard.press("ArrowRight");
  await dialogOverPage.getByText("2 / 3").waitFor();
  check("→ moves only the modal's slides, not the page's", await page.locator("main").getByText("1 / 3").isVisible());
  const views = page.locator("div.fixed.inset-0.z-50.overflow-hidden");
  await dialogOverPage.getByRole("button", { name: "Present" }).click();
  await views.first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  check("Present in the modal shows one view", (await views.count()) === 1, `${await views.count()}`);

  // Back while presenting ends the presentation too, so the next modal still closes.
  await page.goBack();
  await anyDialog.first().waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  check("Back while presenting ends it", (await views.count()) === 0, `${await views.count()}`);
  await page.locator("main a", { hasText: titles.b }).first().click();
  await dialogOverPage.getByRole("heading", { name: titles.b }).waitFor({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await anyDialog.first().waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
  check("…and the next modal still closes with Escape", (await anyDialog.count()) === 0);

  // Make a copy from the modal opens the editor and the modal is gone.
  await page.goto(`${APP}/quizmatter`);
  await page.locator("a", { hasText: titles.a }).first().waitFor({ timeout: 30_000 });
  const historyBefore = await page.evaluate(() => history.length);
  await openA();
  await dialog.getByRole("button", { name: "Make a copy" }).click();
  await page.waitForURL(/\/presentation\/[^/]+\/edit$/, { timeout: 30_000 });
  await page.waitForTimeout(500);
  check("Make a copy opens the editor, the modal is gone", (await page.getByRole("dialog", { name: titles.a }).count()) === 0, page.url());
  const historyAfter = await page.evaluate(() => history.length);
  check("the modal's Back entry is gone (one Back returns to the list)", historyAfter === historyBefore + 1, `${historyBefore} → ${historyAfter}`);

  await context.close();

  // A phone: one column, nothing wider than the screen.
  const phone = await loggedIn(browser, viewer, { width: 390, height: 844 });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${APP}/quizmatter`);
  await phonePage.locator("a", { hasText: titles.a }).first().click({ timeout: 30_000 });
  const phoneDialog = phonePage.getByRole("dialog", { name: titles.a });
  await phoneDialog.getByRole("heading", { name: titles.a }).waitFor({ timeout: 20_000 });
  const overflow = await phoneDialog.evaluate((box) => box.scrollWidth - box.clientWidth);
  check("on a phone the modal fits the screen", overflow <= 0 && (await phoneDialog.boundingBox()).width <= 390, `${overflow}`);
  await phonePage.screenshot({ path: `${SHOTS}presentation-modal-phone.png` });
  await phone.close();
} finally {
  await browser.close();
  await deleteTeacher(viewer);
  await deleteTeacher(admin);
}
finish();
