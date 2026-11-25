// The text bar's "Change case" menu (Aa): the selected words while typing, all the text of a picked box, bold kept,
// one undo step, and saved.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Text", last: "Case" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Text case e2e", data_version: 1 }),
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
        question: "what IS the capital? it is PARIS.",
        questionHtml: "<p>what IS <strong>th</strong>e capital? it is PARIS.</p>",
        layout: "grid",
        options: [
          { id: "s1-a", text: "A" },
          { id: "s1-b", text: "B" },
          { id: "s1-c", text: "C" },
          { id: "s1-d", text: "D" },
        ],
        correctOptionId: null,
        elements: [],
        questionHeight: 150,
      },
    },
  ]),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const pick = async (label) => {
  await page.locator('button[title="Change case"]').click();
  await page.getByRole("button", { name: label, exact: true }).click();
  // Past the half second in which the editor joins edits into one undo step, like a person picking again.
  await page.waitForTimeout(800);
};

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  const box = slide.locator(".ProseMirror", { hasText: "capital" });
  await box.waitFor();
  const text = () => box.innerText();

  // Typing, with nothing selected: the whole text.
  await box.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  await pick("Sentence case");
  check("sentence case on the whole text", (await text()) === "What is the capital? It is paris.", await text());
  check("bold is kept", (await box.locator("strong").innerText()) === "th", await box.innerHTML());
  await page.screenshot({ path: `${SHOTS}text-case-menu.png` });

  // Typing, with a selection: only those words.
  await page.keyboard.press("Control+End");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  await pick("UPPERCASE");
  check("upper only on the selected words", (await text()) === "What is the capital? It is PARIS.", await text());

  await page.keyboard.press("Control+a");
  await pick("Capitalize Each Word");
  check("capitalize each word (split by bold)", (await text()) === "What Is The Capital? It Is Paris.", await text());

  // Undo: one step back.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(500);
  check("undo takes back one change", (await text()) === "What is the capital? It is PARIS.", await text());

  // A picked box (not typing): all its text.
  await box.click();
  await page.waitForTimeout(300);
  await pick("lowercase");
  check("lowercase on a picked box", (await text()) === "what is the capital? it is paris.", await text());

  await page.keyboard.press("Control+s");
  let json = "";
  for (let i = 0; i < 30 && !json.includes("what is"); i++) {
    await page.waitForTimeout(500);
    const [saved] = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&select=data`);
    json = JSON.stringify(saved?.data?.questionHtml ?? "");
  }
  check("saved", json.includes("what is <strong>th</strong>e capital? it is paris."), json);
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("ran without throwing", false, e.message);
  await page.screenshot({ path: `${SHOTS}text-case-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
