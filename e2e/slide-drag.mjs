// The editor's Presentations panel: open another teacher's published presentation and drag its slides into mine
// (after a slide, before slide 1, onto an answer box, into the gap under the last slide, back onto the panel), click
// one to add it, then save and check the order and that each copy is its own slide.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

/** A choice slide as the app saves one. */
function choiceSlide(id, question, elements = []) {
  return {
    id,
    type: "choice",
    question,
    layout: "grid",
    options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: `${question} ${o.toUpperCase()}` })),
    correctOptionId: `${id}-b`,
    elements,
    questionHeight: 100,
  };
}

const tag = Date.now();
const sharer = await makeTeacher({ first: "Sharer" });
const teacher = await makeTeacher({ first: "Dragger" });
const originalId = randomUUID();
const copyId = randomUUID();
const mineId = randomUUID();
// A text box inside the source's answer B: its copy must stay inside the copy's answer B.
const insideB = {
  id: "in-b", assetId: "text-box", x: 10, y: 10, width: 200, height: 60, color: "#1B1530", containerId: "src1-b",
  text: { html: "<p>Inside B</p>" },
};
// A shared copy's slides change only through sharing, so they go in with the same setting.
psql(`
  insert into public.presentations (id, owner_id, title, data_version) values ('${originalId}', '${sharer.id}', 'Drag source ${tag}', 4);
  select set_config('quizmatter.sharing', 'yes', false);
  insert into public.presentations (id, owner_id, title, shared_from, is_published, shared_at, data_version)
    values ('${copyId}', '${sharer.id}', 'Drag source ${tag}', '${originalId}', true, now(), 4);
  insert into public.slides (presentation_id, id, position, data) values
    ('${copyId}', 'src1', 0, $j$${JSON.stringify(choiceSlide("src1", "Source one", [insideB]))}$j$),
    ('${copyId}', 'src2', 1, $j$${JSON.stringify(choiceSlide("src2", "Source two"))}$j$);
`);
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: mineId, owner_id: teacher.id, title: "Mine", data_version: 4 }),
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([
    { presentation_id: mineId, id: "b1", position: 0, data: choiceSlide("b1", "Mine one") },
    { presentation_id: mineId, id: "b2", position: 1, data: choiceSlide("b2", "Mine two") },
  ]),
});

const QUESTIONS = ["Source one", "Source two", "Mine one", "Mine two"];
const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

/** The slides on the workspace, top to bottom, by their question. */
const order = () =>
  page.$$eval(
    "[data-slide-id]",
    (nodes, questions) => nodes.map((node) => questions.find((q) => node.textContent.includes(q)) ?? "?"),
    QUESTIONS
  );
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function waitForOrder(expected) {
  for (let i = 0; i < 40; i++) {
    if (sameList(await order(), expected)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

try {
  await page.goto(`${APP}/presentation/${mineId}/edit`, { timeout: 120_000 });
  await page.locator('[data-slide-id="b2"]').waitFor();
  check("the workspace starts with my two slides", sameList(await order(), ["Mine one", "Mine two"]), JSON.stringify(await order()));

  await page.getByRole("button", { name: "Presentations" }).click();
  await page.getByPlaceholder("Search presentations").fill(String(tag));
  await page.getByRole("button", { name: new RegExp(`Drag source ${tag}`) }).first().click();
  const sourceSlide = (n) => page.locator('button[title="Click to add after the active slide, or drag onto a slide"]').nth(n);
  await sourceSlide(1).waitFor();
  const slideBox = async (id) => page.locator(`[data-slide-id="${id}"]`).boundingBox();

  // 1. Onto the lower part of my slide 2: right after it.
  {
    const box = await slideBox("b2");
    await sourceSlide(1).dragTo(page.locator('[data-slide-id="b2"]'), { targetPosition: { x: box.width / 2, y: box.height * 0.8 } });
    const ok = await waitForOrder(["Mine one", "Mine two", "Source two"]);
    check("dropped on a slide goes right after it", ok, JSON.stringify(await order()));
  }

  // 2. Onto the top half of slide 1: becomes the new slide 1.
  {
    await page.locator('[data-slide-id="b1"]').scrollIntoViewIfNeeded();
    const box = await slideBox("b1");
    await sourceSlide(0).dragTo(page.locator('[data-slide-id="b1"]'), { targetPosition: { x: box.width / 2, y: 30 } });
    const ok = await waitForOrder(["Source one", "Mine one", "Mine two", "Source two"]);
    check("dropped on the top half of slide 1 goes before it", ok, JSON.stringify(await order()));
  }

  // 3. Onto an answer box of my slide 1: still a whole slide, after it (not an element in the box).
  {
    const answer = page.locator('[data-slide-id="b1"]').getByText("Mine one C", { exact: true });
    await answer.scrollIntoViewIfNeeded();
    await sourceSlide(1).dragTo(answer);
    const ok = await waitForOrder(["Source one", "Mine one", "Source two", "Mine two", "Source two"]);
    check("dropped on an answer box goes after that slide", ok, JSON.stringify(await order()));
  }

  // 4. Onto the gray space under the last slide: at the end.
  {
    const last = page.locator("[data-slide-id]").last();
    await page.getByRole("button", { name: "+ Add slide" }).scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    // The gap between the last slide and "+ Add slide".
    await sourceSlide(0).dragTo(last, { targetPosition: { x: box.width / 2, y: box.height + 12 }, force: true });
    const ok = await waitForOrder(["Source one", "Mine one", "Source two", "Mine two", "Source two", "Source one"]);
    check("dropped in the gap under the last slide goes at the end", ok, JSON.stringify(await order()));
  }

  // 5. Back onto the panel: nothing is added.
  {
    await sourceSlide(1).dragTo(page.getByPlaceholder("Search presentations").or(page.locator("p", { hasText: "Click a slide to add" })).first());
    await page.waitForTimeout(500);
    check("dropped back on the panel adds nothing", (await order()).length === 6, JSON.stringify(await order()));
  }

  // 6. A click adds it right after the active slide (the last one added is active).
  {
    await sourceSlide(1).click();
    const ok = await waitForOrder(["Source one", "Mine one", "Source two", "Mine two", "Source two", "Source one", "Source two"]);
    check("a click adds after the active slide", ok, JSON.stringify(await order()));
  }

  // 7. One undo takes the added slide out again. (Changes closer than 500 ms are one undo step.)
  {
    await page.waitForTimeout(700);
    await page.keyboard.press("Control+z");
    const ok = await waitForOrder(["Source one", "Mine one", "Source two", "Mine two", "Source two", "Source one"]);
    check("one undo takes the added slide out", ok, JSON.stringify(await order()));
  }

  // 8. Dropped on a question while typing in it: a slide after it, and no text goes into the question.
  {
    const question = page.locator('[data-slide-id="b2"]').getByText("Mine two", { exact: true });
    await question.scrollIntoViewIfNeeded();
    // Pressing on the panel ends the typing, so the drop lands on the question's text.
    await question.dblclick();
    await page.locator('[data-slide-id="b2"] [contenteditable="true"]').first().waitFor();
    await sourceSlide(0).dragTo(question);
    const ok = await waitForOrder(["Source one", "Mine one", "Source two", "Mine two", "Source one", "Source two", "Source one"]);
    check("dropped on a question being typed in goes after that slide", ok, JSON.stringify(await order()));
  }

  // 9. A drop from another tab running newer app code, or one that isn't a slide: refused with words, nothing added.
  {
    const dropData = (data) =>
      page.evaluate((json) => {
        const target = document.querySelector('[data-slide-id="b1"]');
        const transfer = new DataTransfer();
        transfer.setData("application/x-quizbuilder-slide", json);
        for (const type of ["dragover", "drop"]) {
          target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }
      }, data);
    await dropData(JSON.stringify({ dataVersion: 999, slide: choiceSlide("new", "Source one") }));
    const newer = await page.getByText("QuizMatter was updated. Reload the page to keep editing.").waitFor({ timeout: 5000 }).then(() => true, () => false);
    check("a slide from newer app code is refused with the update message", newer);
    await dropData("not a slide");
    const broken = await page.getByText("This slide couldn't be added.", { exact: false }).waitFor({ timeout: 5000 }).then(() => true, () => false);
    check("a drop that isn't a slide says it couldn't be added", broken);
    check("neither added a slide", (await order()).length === 7, JSON.stringify(await order()));
  }
  await page.screenshot({ path: `${SHOTS}slide-drag.png` });

  // Save and check what the database got.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  let saved = [];
  for (let i = 0; i < 60; i++) {
    saved = await api(`/rest/v1/slides?presentation_id=eq.${mineId}&select=id,position,data&order=position`);
    if (saved.length === 7) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  check("all 7 slides are saved", saved.length === 7, String(saved.length));
  const savedOrder = saved.map((row) => QUESTIONS.find((q) => row.data.question === q) ?? "?");
  check(
    "they are saved in the order shown",
    sameList(savedOrder, ["Source one", "Mine one", "Source two", "Mine two", "Source one", "Source two", "Source one"]),
    JSON.stringify(savedOrder)
  );
  const mineTwo = saved.find((row) => row.id === "b2")?.data.question.replace(/<[^>]*>/g, "");
  check("the question dropped on is unchanged", mineTwo === "Mine two", String(mineTwo));
  const ids = saved.map((row) => row.id);
  check("every copy has its own new id", new Set(ids).size === 7 && !ids.includes("src1") && !ids.includes("src2"), JSON.stringify(ids));
  const copiesOfOne = saved.filter((row) => row.data.question === "Source one").map((row) => row.data);
  check(
    "a copy's picture stays inside its own answer B",
    copiesOfOne.length === 3 &&
      copiesOfOne.every((slide) => {
        const element = slide.elements.find((el) => el.text?.html.includes("Inside B"));
        return element && element.containerId === slide.options[1].id && slide.correctOptionId === slide.options[1].id;
      }),
    JSON.stringify(copiesOfOne.map((s) => ({ options: s.options.map((o) => o.id), elements: s.elements.map((e) => e.containerId) })))
  );
  check(
    "the other teacher's presentation is untouched",
    (await api(`/rest/v1/slides?presentation_id=eq.${copyId}&select=id`)).length === 2
  );
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("the test ran to the end", false, error.message);
  await page.screenshot({ path: `${SHOTS}slide-drag-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
  await deleteTeacher(sharer);
}
finish();
