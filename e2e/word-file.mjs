// The editor's Word file panel: open a .docx, see one line per piece, copy a line, drag lines onto the question box
// and an answer choice (the "1." / "b." marks are removed, the drop replaces the text, Undo brings it back), a line
// dropped on the slide outside the boxes changes nothing, and a file that isn't a .docx is refused.
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const p = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const docx = Buffer.from(
  zipSync({
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document><w:body>${p("1. What gas do plants take in?")}<w:p/>${p("a. Oxygen")}${p("b. Carbon dioxide")}</w:body></w:document>`,
    ),
  }),
);

const teacher = await makeTeacher({ first: "Word" });
const id = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id, owner_id: teacher.id, title: "Word test", data_version: 6 }),
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([
    {
      presentation_id: id, id: "s1", position: 0,
      data: {
        id: "s1", type: "choice", question: "Old question", layout: "grid", elements: [], questionHeight: 100, correctOptionId: null,
        options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: `Old ${o.toUpperCase()}` })),
      },
    },
  ]),
});

const browser = await chromium.launch();
const context = await loggedIn(browser, teacher, { width: 1600, height: 1000 }, { permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const question = page.locator('[data-slide-id="s1"] [data-container-id="question"]');
const optionB = page.locator('[data-slide-id="s1"] [data-container-id="s1-b"]');
const line = (n) => page.locator("[data-word-line]").nth(n);
const waitFor = async (fn) => {
  for (let i = 0; i < 40; i++) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  return false;
};

try {
  await page.goto(`${APP}/presentation/${id}/edit`, { timeout: 120_000 });
  await question.waitFor();
  await page.getByRole("button", { name: "Word file" }).click();

  await page.locator("[data-word-file-input]").setInputFiles({ name: "exam.doc", mimeType: "application/msword", buffer: Buffer.from("old") });
  check("an old .doc is refused with the words", await page.getByText("save it as .docx in Word first").isVisible());

  await page.locator("[data-word-file-input]").setInputFiles({
    name: "exam.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docx,
  });
  await line(0).waitFor();
  const lines = await page.locator("[data-word-line]").allTextContents();
  check(
    "one piece per line, empty line skipped",
    JSON.stringify(lines) === JSON.stringify(["1. What gas do plants take in?", "a. Oxygen", "b. Carbon dioxide"]),
    JSON.stringify(lines),
  );

  await line(1).getByRole("button", { name: "Copy" }).click();
  check("Copy copies the line as it is", (await page.evaluate(() => navigator.clipboard.readText())) === "a. Oxygen");

  await line(0).dragTo(question);
  check("the question becomes the dropped line, without its number", await waitFor(async () => (await question.innerText()).includes("What gas do plants take in?") && !(await question.innerText()).includes("Old question")));
  check("the question has no leading 1.", !(await question.innerText()).includes("1. What"));

  // Changes under 500 ms apart are one undo step (HISTORY_GROUP_MS): wait, so Undo below takes back only this drop.
  await page.waitForTimeout(700);
  await line(2).dragTo(optionB);
  check("answer B becomes the dropped line, without its letter", await waitFor(async () => (await optionB.innerText()).includes("Carbon dioxide") && !(await optionB.innerText()).includes("Old B")));
  check("answer B has no leading b.", !(await optionB.innerText()).includes("b. Carbon"));
  await page.screenshot({ path: `${SHOTS}/word-file.png` });

  await page.locator('button[title="Undo (Ctrl+Z)"]').click();
  check("Undo brings answer B back", await waitFor(async () => (await optionB.innerText()).includes("Old B")));

  const slide = page.locator('[data-slide-id="s1"]');
  await line(1).dragTo(slide, { targetPosition: { x: 8, y: 8 } });
  await page.waitForTimeout(300);
  const unchanged = (await question.innerText()).includes("What gas") && (await optionB.innerText()).includes("Old B");
  const anyOxygen = (await slide.innerText()).includes("Oxygen");
  check("a line dropped outside the boxes changes nothing", unchanged && !anyOxygen, `${await question.innerText()} | ${await optionB.innerText()} | oxygen: ${anyOxygen}`);

  // Touch screens: tap a line's handle, then tap a box.
  const optionC = page.locator('[data-slide-id="s1"] [data-container-id="s1-c"]');
  await line(1).getByRole("button", { name: "Pick up this line, then tap a box" }).click();
  check("tapping the handle shows the Tap a box note", await page.locator("[data-word-held]").isVisible());
  await optionC.click();
  check("a tap on answer C puts the line there, without its letter", await waitFor(async () => (await optionC.innerText()).includes("Oxygen") && !(await optionC.innerText()).includes("a. ")));
  check("the note is gone after placing", (await page.locator("[data-word-held]").count()) === 0);
  await line(1).getByRole("button", { name: "Pick up this line, then tap a box" }).click();
  await page.keyboard.press("Escape");
  check("Escape lets go of the held line and keeps the panel open",
    (await page.locator("[data-word-held]").count()) === 0 && (await page.locator("[data-word-line]").count()) === 3);

  // Ticking lines: the first ticked is the question, the next ones A, B… in click order.
  const tick = (n) => line(n).getByRole("checkbox").click();
  const preview = page.locator("[data-word-preview]");
  await tick(0);
  check("one tick shows the preview with the question, and no Add button yet",
    (await preview.innerText()).includes("What gas do plants take in?") &&
      (await page.getByRole("button", { name: "Add as a new slide" }).count()) === 0);
  await tick(2);
  await tick(1);
  const previewText = await preview.innerText();
  check("the preview puts the 2nd tick in A and the 3rd in B", /A\s*Carbon dioxide/.test(previewText) && /B\s*Oxygen/.test(previewText), previewText);
  await page.getByRole("button", { name: "Add as a new slide" }).click();
  check("Add makes a second slide", await waitFor(async () => (await page.locator("[data-slide-id]").count()) === 2));
  const added = page.locator("[data-slide-id]").nth(1);
  const addedText = await added.innerText();
  check(
    "the new slide has the question and A, B in click order",
    addedText.includes("What gas do plants take in?") && addedText.indexOf("Carbon dioxide") < addedText.indexOf("Oxygen") && !addedText.includes("b. "),
    addedText,
  );
  check("the ticks are cleared after adding", (await preview.count()) === 0);

  // Suggestions: the numbered question and the lines under it, colored, with Create.
  check("no suggestion colors before Show suggestions", (await page.locator("[data-suggested]").count()) === 0);
  await page.getByRole("button", { name: "Show suggestions" }).click();
  check("Show suggestions colors the question and its 2 choices",
    (await page.locator('[data-suggested="question"]').count()) === 1 && (await page.locator('[data-suggested="option"]').count()) === 2);
  const slidesBefore = await page.locator("[data-slide-id]").count();
  await page.locator('[data-suggested="question"]').getByRole("button", { name: "Create" }).click();
  check("Create adds the suggested item as a slide", await waitFor(async () => (await page.locator("[data-slide-id]").count()) === slidesBefore + 1));
  check("its button then says Added", (await page.locator('[data-suggested="question"]').getByRole("button", { name: "Added" }).count()) === 1);
  await page.getByRole("button", { name: "Hide suggestions" }).click();
  check("Hide suggestions takes the colors away", (await page.locator("[data-suggested]").count()) === 0);

  await page.getByRole("button", { name: "Elements" }).click();
  await page.getByRole("button", { name: "Word file" }).click();
  check("closing and opening the panel keeps the list", (await page.locator("[data-word-line]").count()) === 3);

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
