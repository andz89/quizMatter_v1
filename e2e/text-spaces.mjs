// Spaces a teacher types on purpose (several in a row, or at the start of a line) stay after saving and opening
// again: in the editor (Tiptap's `parseOptions`) and the read-only text (`toSafeHtml`). Before, loading saved HTML
// squeezed each run of spaces into one.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const SAVED = "Name:     Score:";
const INDENTED = "   Indented";
const teacher = await makeTeacher({ first: "Text", last: "Spaces" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Text spaces e2e", data_version: 1 }),
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
        type: "choice",
        question: "Question",
        layout: "grid",
        options: [
          { id: "s1-a", text: "A" },
          { id: "s1-b", text: "B" },
          { id: "s1-c", text: "C" },
          { id: "s1-d", text: "D" },
        ],
        correctOptionId: null,
        elements: [
          {
            id: "tb",
            assetId: "text-box",
            x: 760,
            y: 20,
            width: 480,
            height: 120,
            color: "#1B1530",
            containerId: null,
            text: { html: `<p>${SAVED}</p><p>${INDENTED}</p>` },
          },
          // As an older Claude import saved it: a tab, and a "\r" left at a line's end.
          {
            id: "old",
            assetId: "text-box",
            x: 760,
            y: 160,
            width: 480,
            height: 120,
            color: "#1B1530",
            containerId: null,
            text: { html: "<p>Answer:\tParis</p><p>One\r</p>" },
          },
        ],
        questionHeight: 150,
      },
    },
  ]),
});

const lines = (locator) => locator.evaluate((root) => [...root.querySelectorAll("p")].map((p) => p.textContent));
// The spaces also show on screen: the text keeps them in its CSS (a squeezing `white-space` would show one).
const spacesShow = (locator) =>
  locator.evaluate((root) => [...root.querySelectorAll("p")].every((p) => ["break-spaces", "pre-wrap"].includes(getComputedStyle(p).whiteSpace)));

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  await slide.waitFor();
  const box = slide.locator(".ProseMirror", { hasText: "Score:" });
  await box.waitFor();
  const opened = await lines(box);
  check("the editor keeps a saved run of spaces", opened[0] === SAVED, JSON.stringify(opened));
  check("the editor keeps spaces at the start of a line", opened[1] === INDENTED, JSON.stringify(opened));
  const oldBox = slide.locator(".ProseMirror", { hasText: "Paris" });
  const oldLines = await lines(oldBox);
  check("an older import's tab and \\r show as before (one space, nothing)", JSON.stringify(oldLines) === JSON.stringify(["Answer: Paris", "One"]), JSON.stringify(oldLines));

  // Type more spaces, save, and open again.
  await box.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("    end");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  let json = "";
  for (let i = 0; i < 30 && !json.includes("end"); i++) {
    await page.waitForTimeout(500);
    const [saved] = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&select=data`);
    json = JSON.stringify(saved?.data ?? {});
  }
  check("the save keeps typed spaces", json.includes(`${INDENTED}    end`), json.slice(0, 400));

  await page.reload({ timeout: 120_000 });
  await box.waitFor();
  const reopened = await lines(box);
  check("the editor shows them on screen", await spacesShow(box));
  check("after opening again the editor keeps them", JSON.stringify(reopened) === JSON.stringify([SAVED, `${INDENTED}    end`]), JSON.stringify(reopened));

  // Undo after typing puts the old text back from outside the editor (setContent): the spaces stay.
  await box.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("!!");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(500);
  const undone = await lines(box);
  check("undo keeps them", JSON.stringify(undone) === JSON.stringify([SAVED, `${INDENTED}    end`]), JSON.stringify(undone));

  // Presenting fullscreen (SlideStaticView → SlideText → toSafeHtml).
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  const presented = page.locator('[aria-hidden="false"]').filter({ hasText: "Score:" }).first();
  await presented.waitFor();
  await page.waitForTimeout(1000);
  // The text box's own SlideText (the slide also shows the question, choices and the other box).
  const presentedLines = await lines(presented.locator(".whitespace-break-spaces").filter({ hasText: "Score:" }));
  check("presenting fullscreen keeps them", JSON.stringify(presentedLines) === JSON.stringify([SAVED, `${INDENTED}    end`]), JSON.stringify(presentedLines));
  check("presenting shows them on screen", await spacesShow(presented));
  await page.screenshot({ path: `${SHOTS}text-spaces-present.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // The view page (SlideText → toSafeHtml).
  await page.goto(`${APP}/presentation/${presentationId}`, { timeout: 120_000 });
  // Every copy of the text box's SlideText (the slide and any thumbnail of it).
  const shown = page.locator(".whitespace-break-spaces").filter({ hasText: "Score:" });
  await shown.first().waitFor();
  const viewed = [];
  for (const copy of await shown.all()) viewed.push(JSON.stringify(await lines(copy)));
  const expected = JSON.stringify([SAVED, `${INDENTED}    end`]);
  check("the view page keeps them", viewed.length > 0 && viewed.every((v) => v === expected), viewed.join(" | "));
  let showsAll = true;
  for (const copy of await shown.all()) showsAll &&= await spacesShow(copy);
  check("the view page shows them on screen", showsAll);
  await page.screenshot({ path: `${SHOTS}text-spaces-view.png` });

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("ran without throwing", false, e.message);
  await page.screenshot({ path: `${SHOTS}text-spaces-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
