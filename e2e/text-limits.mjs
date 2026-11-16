// Text limits while typing: the question, an answer choice and a text box refuse a change that would go past the
// limits zod checks on save (text 5,000, HTML 50,000), with one toast; shorter text goes in and deleting still works.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const MESSAGE = "This text is at its limit";

const teacher = await makeTeacher({ first: "Limits" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Text limits e2e", data_version: 1 }),
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
        question: "Q",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: o.toUpperCase() })),
        correctOptionId: null,
        elements: [
          { id: "box", assetId: "text-box", x: 100, y: 600, width: 400, height: 100, color: "#1B1530", containerId: null, text: { html: "<p>Box</p>" } },
        ],
        questionHeight: 100,
      },
    },
  ]),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

/** Pastes plain text into whatever has focus, like Ctrl+V. */
const paste = (text) =>
  page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  await slide.waitFor();
  const editable = slide.locator('[contenteditable="true"]');
  const typed = async () => (await editable.innerText()).replace(/\n$/, "");
  const toasts = page.locator("[data-sonner-toast]", { hasText: MESSAGE });
  const stopTyping = async () => {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]'));
  };

  // The question: the text limit.
  await slide.locator(".ProseMirror", { hasText: /^Q$/ }).dblclick();
  await editable.waitFor();
  await page.keyboard.press("End");
  await paste("x".repeat(5_000));
  check("the question refuses a paste past 5,000 characters", (await typed()) === "Q", `${(await typed()).length} characters`);
  check("a toast says why", (await toasts.count()) === 1);
  await paste("y".repeat(5_000));
  check("a second refusal shows no second toast", (await toasts.count()) === 1, String(await toasts.count()));
  await paste("x".repeat(4_999));
  check("a paste up to 5,000 goes in", (await typed()).length === 5_000, String((await typed()).length));
  await page.keyboard.type("z");
  check("typing past the limit is refused too", (await typed()).length === 5_000 && !(await typed()).includes("z"));
  await page.keyboard.press("Backspace");
  check("deleting at the limit still works", (await typed()).length === 4_999, String((await typed()).length));
  await stopTyping();

  // An answer choice: the text limit.
  await slide.locator(".ProseMirror", { hasText: /^A$/ }).dblclick();
  await editable.waitFor();
  await page.keyboard.press("End");
  await paste("x".repeat(5_000));
  check("an answer choice refuses a paste past 5,000 characters", (await typed()) === "A", `${(await typed()).length} characters`);
  await stopTyping();

  // A text box: only the HTML limit.
  await slide.locator('[data-element-id="box"]').dblclick();
  await editable.waitFor();
  await page.keyboard.press("End");
  await paste("x".repeat(50_000));
  check("a text box refuses a paste past 50,000 characters", (await typed()) === "Box", `${(await typed()).length} characters`);
  await paste("&".repeat(10_000));
  check('a text box refuses 10,000 "&" (50,000+ characters as HTML)', (await typed()) === "Box", `${(await typed()).length} characters`);
  await paste("&".repeat(9_000));
  check('a text box takes 9,000 "&" (under 50,000 as HTML)', (await typed()).length === 9_003, String((await typed()).length));
  await stopTyping();

  // Saved as typed.
  await page.keyboard.press("Control+s");
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) {
    const rows = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.s1&select=data`);
    if (rows[0]?.data?.question?.length === 4_999) saved = rows[0].data;
    else await new Promise((r) => setTimeout(r, 250));
  }
  check("Ctrl+S saves the question at 4,999 characters", saved !== null);
  check("and the text box's 9,000 \"&\"", saved?.elements?.[0]?.text?.html?.includes("&amp;".repeat(9_000)) === true);

  // The slide name box.
  await page.locator('button[title="Rename slide"]').click();
  check("the slide name box stops at 5,000 characters", (await page.locator("input[placeholder]").first().getAttribute("maxlength")) === "5000");

  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: `${SHOTS}text-limits.png` });
} catch (e) {
  check("ran without throwing", false, e.message);
  await page.screenshot({ path: `${SHOTS}text-limits-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
