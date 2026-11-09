// The top bar's Save button at laptop width, with a text box picked (the widest toolbar): it never runs into the
// toolbar in the middle of the bar, in any state (saved, unsaved, saving, couldn't save), and keeps its size while it
// saves, so auto save doesn't make it jump every 12 seconds.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Savebutton" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "", data_version: 1 }),
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([
    {
      presentation_id: presentationId,
      id: "s1",
      position: 0,
      data: {
        id: "s1",
        type: "blank",
        question: "",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: "" })),
        correctOptionId: null,
        elements: [],
        questionHeight: 100,
      },
    },
  ]),
});

const SAVE_RPC = "**/rpc/save_presentation*";
const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1280, height: 720 })).newPage();
page.setDefaultTimeout(60_000);

/** The Save button's width, and the room between the middle toolbar and it (below 0 = they overlap). */
async function measure() {
  return page.evaluate(() => {
    const bar = document.querySelector("header");
    const toolbar = bar.querySelector(":scope > .order-last").getBoundingClientRect();
    const save = [...bar.querySelectorAll("button")].find((b) => /^Save( as draft)? \(Ctrl\+S\)|^Couldn't save/.test(b.title));
    const box = save.getBoundingClientRect();
    return { width: Math.round(box.width), room: Math.round(box.left - toolbar.right), text: save.textContent };
  });
}
const report = (name, m) => check(`${name}: no overlap with the toolbar`, m.room >= 0, `"${m.text}", ${m.width} px wide, room ${m.room} px`);

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator('[data-slide-id="s1"]').waitFor();
  await page.locator('button[title="Elements"]').click();
  await page.getByRole("button", { name: "Text box", exact: true }).click();
  await page.locator('button[title="Bigger text"]').waitFor();
  await page.locator('button[title="Elements"]').click();

  await page.keyboard.press("Control+s");
  await page.getByRole("button", { name: "Saved", exact: true }).waitFor();
  report("saved", await measure());

  await page.locator('button[title="Bigger text"]').click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor();
  const unsaved = await measure();
  report("unsaved", unsaved);

  // Saving: the save waits until the button has been measured.
  let release = () => {};
  const held = new Promise((resolve) => (release = resolve));
  await page.route(SAVE_RPC, async (route) => {
    await held;
    await route.continue();
  });
  await page.keyboard.press("Control+s");
  await page.locator("header .animate-spin").first().waitFor();
  const saving = await measure();
  report("saving", saving);
  check("saving: the button keeps its size", saving.width === unsaved.width, `${unsaved.width} → ${saving.width} px`);
  await page.screenshot({ path: SHOTS + "save-button-saving.png", clip: { x: 0, y: 0, width: 1280, height: 70 } });
  release();
  await page.getByRole("button", { name: "Saved", exact: true }).waitFor();
  await page.unroute(SAVE_RPC);

  // Couldn't save.
  await page.route(SAVE_RPC, (route) => route.abort());
  await page.locator('button[title="Bigger text"]').click();
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => document.querySelector("header .text-danger-strong"));
  report("couldn't save", await measure());
  await page.screenshot({ path: SHOTS + "save-button-error.png", clip: { x: 0, y: 0, width: 1280, height: 70 } });
  await page.unroute(SAVE_RPC);
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
  await page.screenshot({ path: SHOTS + "save-button-failure.png" });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
