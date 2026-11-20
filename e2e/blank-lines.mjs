// Fill-in blanks ("___"): Lexend's "_" leaves a gap on each side, so a row of them showed broken. A run of two or more
// gets the `qm-blank` class (tighter letter spacing) in the editor (a Tiptap decoration) and the read-only text
// (`markBlanks`), so it shows as one line. Display only: the saved text never gets the span.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Blank", last: "Lines" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Blank lines e2e", data_version: 1 }),
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
        question: "Before yesterday, we ___ the script. file_name",
        layout: "grid",
        options: [
          { id: "s1-a", text: "A", html: "<p>By <strong>Friday</strong>, we ____ it.</p>" },
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

// Each `.qm-blank` in `root`: its text, its letter spacing, and its width compared with the same underscores without
// the class (`ratio`; Lexend's "_" is 0.69em wide with 0.59em of line, so a joined blank is about 0.855 of it).
const blanksIn = (locator) =>
  locator.evaluate((root) =>
    [...root.querySelectorAll(".qm-blank")].map((s) => {
      const plain = document.createElement("span");
      plain.textContent = s.textContent;
      s.after(plain);
      const ratio = s.getBoundingClientRect().width / plain.getBoundingClientRect().width;
      plain.remove();
      return { text: s.textContent, ratio, spacing: getComputedStyle(s).letterSpacing };
    })
  );

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  await slide.waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const question = slide.locator(".ProseMirror", { hasText: "Before yesterday" });
  const qBlanks = await blanksIn(question);
  check("the editor marks the question's ___", qBlanks.length === 1 && qBlanks[0].text === "___", JSON.stringify(qBlanks));
  check("with tighter letter spacing", qBlanks[0]?.spacing.startsWith("-"), qBlanks[0]?.spacing);
  check("a single _ (file_name) isn't marked", !(await question.evaluate((q) => [...q.querySelectorAll(".qm-blank")].some((s) => s.textContent === "_"))));
  const option = slide.locator(".ProseMirror", { hasText: "Friday" });
  const oBlanks = await blanksIn(option);
  check("the editor marks a styled option's ____", oBlanks.length === 1 && oBlanks[0].text === "____", JSON.stringify(oBlanks));
  await question.screenshot({ path: `${SHOTS}blank-lines-editor.png` });

  // Typing keeps marking (a new run), and saving never saves the span.
  await question.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" and __");
  await page.waitForTimeout(200);
  const typed = await blanksIn(question);
  check("a run typed in is marked at once", typed.length === 2 && typed[1].text === "__", JSON.stringify(typed));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  // Wait (up to 15 s) for the save to reach the database.
  let json = "";
  for (let i = 0; i < 30 && !json.includes("and __"); i++) {
    await page.waitForTimeout(500);
    const [saved] = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&select=data`);
    json = JSON.stringify(saved?.data ?? {});
  }
  check("the save kept the typed text", json.includes("file_name and __"), json.slice(0, 300));
  check("the saved text has no qm-blank span", !json.includes("qm-blank"));

  // The view page (SlideText) marks them too, the same width as the editor.
  await page.goto(`${APP}/presentation/${presentationId}`, { timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  const viewBlanks = await blanksIn(page.locator("body"));
  const triple = viewBlanks.find((b) => b.text === "___");
  check("the view page marks the blanks", !!triple && viewBlanks.some((b) => b.text === "____"), JSON.stringify(viewBlanks));
  check(
    "a blank is joined the same in the view as in the editor (about 0.855 of its plain width)",
    !!triple && Math.abs(triple.ratio - 0.855) < 0.02 && Math.abs(qBlanks[0].ratio - 0.855) < 0.02,
    `${triple?.ratio} vs ${qBlanks[0]?.ratio}`
  );
  await page.screenshot({ path: `${SHOTS}blank-lines-view.png` });

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("ran without throwing", false, e.message);
  await page.screenshot({ path: `${SHOTS}blank-lines-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
