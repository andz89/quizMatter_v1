// The table element: add it, type in cells, Tab, add and delete rows and columns, save, reload, present.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

// Changes closer together than 500 ms are one undo step (HISTORY_GROUP_MS), and a script clicks far faster than that.
const UNDO_STEP_MS = 700;

/** A blank slide as the app saves one, with these elements. */
function blankSlide(elements) {
  return {
    id: "s1",
    type: "blank",
    question: "",
    layout: "grid",
    options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: "" })),
    correctOptionId: null,
    elements,
    questionHeight: 100,
  };
}

const teacher = await makeTeacher({ first: "Table" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Table e2e", data_version: 1 }),
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([
    { presentation_id: presentationId, id: "s1", position: 0, data: blankSlide([]) },
  ]),
});

async function savedTables() {
  const rows = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.s1&select=data`);
  return (rows[0]?.data?.elements ?? []).filter((el) => el.assetId === "table");
}
async function waitForSaved(test) {
  for (let i = 0; i < 40; i++) {
    if (test(await savedTables())) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const textOf = (table, row, column) => table?.table.rows[row][column].html.replace(/<[^>]*>/g, "");

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  await slide.waitFor();
  const grid = slide.locator("[data-element-id] .grid").first();
  const cell = (row, column) => grid.locator(`[data-table-row="${row}"][data-table-column="${column}"]`);
  const cellCount = () => grid.locator("[data-table-row]").count();
  const waitForCells = (count) =>
    page.waitForFunction((n) => document.querySelectorAll('[data-slide-id="s1"] [data-table-row]').length === n, count);
  const editable = slide.locator('[contenteditable="true"]');
  const plusRow = page.locator('button[title="Add a row"]');
  const plusColumn = page.locator('button[title="Add a column"]');
  const menu = page.locator('[data-element-toolbar] button[title="Table"]');
  const menuItem = (name) => page.getByRole("button", { name, exact: true });
  const size = async () => {
    const box = await slide.locator("[data-element-id]").first().boundingBox();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  };

  // Add it.
  await page.locator('button[title="Elements"]').click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await grid.waitFor();
  check("a new table has 9 cells", (await cellCount()) === 9, String(await cellCount()));

  // Type, Tab, type. A double-click types at once, as with a text box.
  await cell(0, 0).dblclick();
  await editable.waitFor();
  await page.keyboard.type("Name");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Score");
  check("the text toolbar shows while typing in a cell", (await page.locator('button[title="Bold (Ctrl+B)"]').count()) === 1);
  await page.locator('button[title="Bold (Ctrl+B)"]').click();
  check("still typing after using the text toolbar", (await editable.count()) === 1);
  // Text size while typing: for the whole table.
  await page.locator('button[title="Bigger text"]').click();
  check("still typing after changing the text size", (await editable.count()) === 1);
  await page.locator('button[title="Smaller text"]').click();
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab goes back to the first cell", (await editable.innerText()).trim() === "Name");
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab on the first cell stays there", (await editable.innerText()).trim() === "Name");

  // A click on another cell while typing moves the typing there.
  await cell(2, 2).click();
  await page.keyboard.type("Last");
  await page.keyboard.press("Tab");
  check("Tab on the last cell stays there and keeps its text", (await editable.innerText()).trim() === "Last");

  await page.keyboard.press("Control+s");
  check(
    "saved: the typed cells",
    await waitForSaved((t) => textOf(t[0], 0, 0) === "Name" && textOf(t[0], 0, 1) === "Score" && textOf(t[0], 2, 2) === "Last"),
  );

  // Escape stops typing; the cell stays picked and the table selected.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]'));
  check('Escape stops typing and the table stays selected (its "+" shows)', (await plusRow.count()) === 1);

  // The two "+".
  const before = await size();
  await plusRow.click();
  check("+ adds a row", (await cellCount()) === 12, String(await cellCount()));
  const taller = await size();
  check("the table got one row taller", Math.abs(taller.height - (before.height * 4) / 3) <= 2, JSON.stringify({ before, taller }));
  await plusColumn.click();
  check("+ adds a column", (await cellCount()) === 16, String(await cellCount()));
  const wider = await size();
  check("the table got one column wider", Math.abs(wider.width - (before.width * 4) / 3) <= 2, JSON.stringify({ before, wider }));

  // The Table menu acts on the picked cell.
  await cell(0, 0).click();
  await menu.click();
  await page.getByText("Row 1 · Column 1", { exact: true }).waitFor();
  check("the menu names the picked cell", true);
  await page.screenshot({ path: SHOTS + "table-element-menu.png" });
  await page.waitForTimeout(UNDO_STEP_MS);
  await menuItem("Add row below").click();
  check("Add row below adds a row", (await cellCount()) === 20, String(await cellCount()));
  await page.getByText("Row 2 · Column 1", { exact: true }).waitFor();
  check("the new row's cell is picked", true);
  check("Add row below went under the first row", (await cell(2, 0).innerText()).trim() === "");

  await page.waitForTimeout(UNDO_STEP_MS);
  await page.keyboard.press("Control+z");
  await waitForCells(16);
  check("undo takes the row away", (await cellCount()) === 16);

  // Undo takes away the very row the picked cell is in: nothing breaks and the pick is let go.
  await cell(3, 0).click();
  await page.getByText("Row 4 · Column 1", { exact: true }).waitFor();
  await page.waitForTimeout(UNDO_STEP_MS);
  await menuItem("Add row below").click();
  await page.getByText("Row 5 · Column 1", { exact: true }).waitFor();
  await page.waitForTimeout(UNDO_STEP_MS);
  await page.keyboard.press("Control+z");
  await waitForCells(16);
  await page.getByText("Row 4 · Column 4", { exact: true }).waitFor();
  check("undo of the picked cell's row lets go of the pick (the menu is back on the last cell)", true);

  await menuItem("Delete column").click();
  check("Delete column removes a column", (await cellCount()) === 12, String(await cellCount()));
  await menu.click();

  // Delete empties the picked cell and keeps the table. The last row's picked cell has no text, so pick "Name".
  await cell(0, 1).click();
  await page.waitForTimeout(UNDO_STEP_MS);
  await page.keyboard.press("Delete");
  check("Delete empties the picked cell", (await cell(0, 1).innerText()).trim() === "");
  check("Delete keeps the table", (await cellCount()) === 12);
  await page.keyboard.press("Control+z");
  await cell(0, 1).getByText("Score").waitFor();
  check("undo brings the text back", true);
  await page.keyboard.press("Escape");

  // Undo while typing in a row that undo takes away.
  await page.waitForTimeout(UNDO_STEP_MS);
  await plusRow.click();
  await waitForCells(15);
  await cell(4, 0).dblclick();
  await editable.waitFor();
  await page.waitForTimeout(UNDO_STEP_MS);
  await page.keyboard.press("Control+z");
  await waitForCells(12);
  check("undo while typing in a new row takes it away and stops typing", (await editable.count()) === 0);

  // A duplicate keeps its text, and changing it leaves the original alone.
  await page.locator('button[title="Duplicate"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-slide-id="s1"] [data-element-id]').length === 2);
  check("the duplicate keeps the text", (await slide.locator("[data-element-id]").nth(1).getByText("Name").count()) === 1);
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => document.querySelectorAll('[data-slide-id="s1"] [data-element-id]').length === 1);

  await page.screenshot({ path: SHOTS + "table-element.png" });

  // Saved and reloaded.
  await page.keyboard.press("Control+s");
  check(
    "saved: 4 rows, 3 columns",
    await waitForSaved((t) => t.length === 1 && t[0].table.rows.length === 4 && t[0].table.rows[0].length === 3 && textOf(t[0], 0, 0) === "Name"),
  );
  await page.reload();
  await slide.waitFor();
  await grid.getByText("Name").waitFor();
  check("after reload: the text is there", true);
  check("after reload: 12 cells", (await cellCount()) === 12);

  // A double-click on a table that isn't selected types at once.
  await cell(1, 1).dblclick();
  await editable.waitFor();
  check("a double-click on an unselected table types in that cell", (await editable.count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]'));

  // Text size with the table selected: the whole table's, and it's saved.
  await page.locator('[data-element-toolbar] button[title="Bigger text"]').click();
  await page.keyboard.press("Control+s");
  check("saved: the table's text size", await waitForSaved((t) => t[0]?.table.fontSize === 28));

  // Dragging a column's or row's line changes only that one, like Excel.
  const widths = () => Promise.all([0, 1, 2].map(async (c) => (await cell(0, c).boundingBox()).width));
  const heights = () => Promise.all([0, 1].map(async (r) => (await cell(r, 0).boundingBox()).height));
  const near = (a, b) => Math.abs(a - b) <= 3;
  async function dragLine(title, index, dx, dy) {
    const box = await page.locator(`[title="${title}"]`).nth(index).boundingBox();
    // Near the start of the line, in the first row or column: where lines cross, a row's line is on top.
    const [x, y] = [box.x + Math.min(box.width / 2, 20), box.y + Math.min(box.height / 2, 20)];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2);
    await page.mouse.move(x + dx, y + dy);
    await page.mouse.up();
  }
  const widthsBefore = await widths();
  const tableBefore = await size();
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragLine("Change column width", 0, 80, 0);
  const widthsAfter = await widths();
  const tableAfter = await size();
  check("dragging a column's line makes it wider", near(widthsAfter[0], widthsBefore[0] + 80), JSON.stringify({ widthsBefore, widthsAfter }));
  check("the other columns keep their width", near(widthsAfter[1], widthsBefore[1]) && near(widthsAfter[2], widthsBefore[2]));
  check("the table got wider by the same amount", near(tableAfter.width, tableBefore.width + 80), JSON.stringify({ tableBefore, tableAfter }));
  check("still selected after dragging a line", (await plusRow.count()) === 1);

  const heightsBefore = await heights();
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragLine("Change row height", 0, 0, -20);
  const heightsAfter = await heights();
  check("dragging a row's line makes it shorter", near(heightsAfter[0], heightsBefore[0] - 20), JSON.stringify({ heightsBefore, heightsAfter }));
  check("the other row keeps its height", near(heightsAfter[1], heightsBefore[1]));

  // One undo takes back one whole drag.
  await page.waitForTimeout(UNDO_STEP_MS);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(UNDO_STEP_MS);
  check("one undo takes back the whole row drag", near((await heights())[0], heightsBefore[0]));
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragLine("Change row height", 0, 0, -20);

  await page.screenshot({ path: SHOTS + "table-element-sized.png" });
  await page.keyboard.press("Control+s");
  check(
    "saved: the dragged sizes",
    await waitForSaved((t) => t[0]?.table.columnSizes?.length === 3 && t[0]?.table.rowSizes?.length === 4),
  );
  await page.reload();
  await grid.getByText("Name").waitFor();
  const widthsLoaded = await widths();
  check("after reload the columns keep their sizes", widthsAfter.every((w, i) => near(w, widthsLoaded[i])), JSON.stringify({ widthsAfter, widthsLoaded }));

  // A click right on a cell still picks it, and the lines are gone while typing.
  await grid.click({ position: { x: 300, y: 60 } });
  await cell(1, 1).dblclick();
  await editable.waitFor();
  check("no draggable lines while typing", (await page.locator('[title="Change column width"]').count()) === 0);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]'));

  // Near the bottom of the slide: a new row stops at the edge.
  const moved = await savedTables();
  await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.s1`, {
    method: "PATCH",
    body: JSON.stringify({ data: blankSlide([{ ...moved[0], y: 720 - moved[0].height }]) }),
  });
  await page.reload();
  await grid.getByText("Name").waitFor();
  await grid.click({ position: { x: 300, y: 60 } });
  const atEdge = await size();
  await plusRow.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-slide-id="s1"] [data-table-row]').length === 15);
  const stillAtEdge = await size();
  check("at the slide's bottom edge a new row doesn't make it taller", atEdge.height === stillAtEdge.height, JSON.stringify({ atEdge, stillAtEdge }));

  // At the edge a row can't make the table taller, so it takes room from the row under it.
  const edgeBefore = await heights();
  await dragLine("Change row height", 0, 0, 15);
  const edgeAfter = await heights();
  check("at the edge a dragged row grows", near(edgeAfter[0], edgeBefore[0] + 15), JSON.stringify({ edgeBefore, edgeAfter }));
  check("at the edge the next row gives up the room", near(edgeAfter[1], edgeBefore[1] - 15));
  check("at the edge the table's height stays", near((await size()).height, stillAtEdge.height));

  // Present shows the text.
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  // Inside the presenting view itself (the editor stays under it, with the same text).
  const presenting = page.locator("div.fixed.inset-0.z-50");
  await page.waitForFunction(() => document.documentElement.dataset.presenting === "true");
  await presenting.locator("[data-table-row]").first().waitFor();
  await presenting.getByText("Score", { exact: true }).first().waitFor();
  check("presenting shows the table's text", true);
  check("presenting shows all the cells", (await presenting.locator("[data-table-row]").count()) >= 15);
  await page.screenshot({ path: SHOTS + "table-element-present.png" });

  // On a question slide the table goes in the shape box: typing and the "+" work there too.
  const questionId = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id: questionId, owner_id: teacher.id, title: "Table on a question", data_version: 1 }),
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify([{ presentation_id: questionId, id: "s1", position: 0, data: { ...blankSlide([]), type: "choice", question: "Which?" } }]),
  });
  const page2 = await page.context().newPage();
  page2.on("pageerror", (e) => errors.push(e.message));
  await page2.goto(`${APP}/presentation/${questionId}/edit`, { timeout: 120_000 });
  const questionSlide = page2.locator('[data-slide-id="s1"]');
  await questionSlide.waitFor();
  await page2.locator('button[title="Elements"]').click();
  await page2.getByRole("button", { name: "Table", exact: true }).first().click();
  const boxCells = questionSlide.locator("[data-table-row]");
  await boxCells.first().waitFor();
  check("on a question slide the table has 9 cells", (await boxCells.count()) === 9, String(await boxCells.count()));
  await boxCells.first().dblclick();
  await questionSlide.locator('[contenteditable="true"]').last().waitFor();
  await page2.keyboard.type("In a box");
  await page2.keyboard.press("Escape");
  check("typing works in a table in a box", (await boxCells.first().innerText()).trim() === "In a box");
  const boxPlus = page2.locator('button[title="Add a row"]');
  check('the "+" shows on a table in a box', await boxPlus.isVisible());
  await boxPlus.click();
  check("+ adds a row to a table in a box", (await boxCells.count()) === 12, String(await boxCells.count()));
  await page2.screenshot({ path: SHOTS + "table-element-question.png" });
  await page2.close({ runBeforeUnload: false });

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
  await page.screenshot({ path: SHOTS + "table-element-failure.png" });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
