// The table element at its edges: text too long for its cell (seeded, typed, pasted, a long word, emoji), text the
// app must show as letters (<script>, &), a huge text size, a table shrunk under its text, 15 × 15 and 1 × 1 at the
// limits, a paste past the 50,000 limit, broken saved tables, and presenting a cut-off cell. Each scenario has its own
// presentation and page, so one failure can't hide the next. `ONLY="paste|limits"` runs just the ones that match.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
const MARK = "[data-hidden-text-mark]";
const LIMIT_MESSAGE = "This text is at its limit. Shorten it to add more.";
// Changes closer together than 500 ms are one undo step (HISTORY_GROUP_MS).
const UNDO_STEP_MS = 700;

/** A blank slide as the app saves one, with these elements. */
const blankSlide = (elements) => ({
  id: "s1",
  type: "blank",
  question: "",
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: "" })),
  correctOptionId: null,
  elements,
  questionHeight: 100,
});

/** A table element; `rows` is text per cell ("" = empty). `extra` goes into `table` (fontSize, columnSizes, …). */
const table = (id, rows, { x = 100, y = 100, width = 600, height = 300, ...extra } = {}) => ({
  id,
  assetId: "table",
  x,
  y,
  width,
  height,
  color: "#1B1530",
  containerId: null,
  table: { rows: rows.map((cells) => cells.map((text) => ({ html: text ? `<p>${text}</p>` : "" }))), ...extra },
});
const grid = (rows, columns, text = () => "") =>
  Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => text(r, c)));

const teacher = await makeTeacher({ first: "Overflow", last: "Table" });
const browser = await chromium.launch();
const context = await loggedIn(browser, teacher, { width: 1600, height: 1000 });

/**
 * One scenario: a new presentation with one blank slide holding `elements`, opened in the editor on a new page.
 * `run` gets helpers; an exception fails only this scenario.
 */
async function scenario(name, elements, run) {
  if (ONLY && !ONLY.test(name)) return;
  const id = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id, owner_id: teacher.id, title: `Table: ${name}`, data_version: 1 }),
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify([{ presentation_id: id, id: "s1", position: 0, data: blankSlide(elements) }]),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let dialogs = 0;
  page.on("dialog", (d) => {
    // "Leave page?" on close is fine; anything else (an alert from cell text) is not.
    if (d.type() !== "beforeunload") dialogs++;
    d.dismiss().catch(() => {});
  });
  const ok = (what, pass, detail) => check(`${name}: ${what}`, pass, detail);
  const slide = page.locator('[data-slide-id="s1"]');
  const el = (elementId) => slide.locator(`[data-element-id="${elementId}"]`);
  const t = {
    page,
    slide,
    ok,
    el,
    cell: (row, column, elementId = "tbl") => el(elementId).locator(`[data-table-row="${row}"][data-table-column="${column}"]`),
    editable: slide.locator('[contenteditable="true"]'),
    marks: (locator = slide) => locator.locator(MARK).count(),
    /** Slide px per screen px is the editor's zoom: the slide is 1280 wide. */
    scale: async () => (await slide.boundingBox()).width / 1280,
    box: async (locator) => {
      const b = await locator.boundingBox();
      return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    },
    /** What a cell shows: its text size, whether its text is taller than it (cut off) or pokes out sideways. */
    measure: (locator) =>
      locator.evaluate((cell) => {
        const p = cell.querySelector("p");
        // Where the text really ends (its own box clips it, so the cell itself never scrolls).
        const range = document.createRange();
        range.selectNodeContents(cell);
        const rects = [...range.getClientRects()].filter((r) => r.height > 0);
        const textBottom = Math.max(...rects.map((r) => r.bottom));
        return {
          fontSize: p ? parseFloat(getComputedStyle(p).fontSize) : null,
          cutOff: textBottom > cell.getBoundingClientRect().bottom + 1,
          pokesOut: cell.scrollWidth > cell.clientWidth + 1 || (p ? p.scrollWidth > p.clientWidth + 1 : false),
          clipped: getComputedStyle(cell).overflow === "hidden",
        };
      }),
    async stopTyping() {
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]'));
    },
    /** Pastes plain text into whatever has focus, like Ctrl+V. */
    paste: (text) =>
      page.evaluate((x) => {
        const data = new DataTransfer();
        data.setData("text/plain", x);
        document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }, text),
    /** The saved tables, read from the database. */
    async saved() {
      const rows = await api(`/rest/v1/slides?presentation_id=eq.${id}&id=eq.s1&select=data`);
      return (rows[0]?.data?.elements ?? []).filter((e) => e.assetId === "table");
    },
    async waitForSaved(test) {
      for (let i = 0; i < 40; i++) {
        if (test(await t.saved())) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    },
    async drag(from, dx, dy) {
      const [x, y] = [from.x + from.width / 2, from.y + from.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 15 });
      await page.mouse.up();
    },
  };
  try {
    await page.goto(`${APP}/presentation/${id}/edit`, { timeout: 120_000 });
    await slide.waitFor();
    await page.waitForTimeout(400);
    await run(t);
    ok("no page errors", errors.length === 0, errors.join(" | "));
    ok("no alert or other box opened", dialogs === 0, String(dialogs));
  } catch (error) {
    ok("finished without an exception", false, String(error).split("\n").slice(0, 3).join(" "));
    await page.screenshot({ path: `${SHOTS}table-overflow-failure-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  } finally {
    await page.close({ runBeforeUnload: false });
  }
}

const LINES = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("<br>");

try {
  // ─── Text far too long for its cell, saved that way ─────────────────────────────────────────────────────────
  await scenario("a cut-off saved cell", [table("tbl", [["fits", LINES], ["a", "b"]], { width: 400, height: 200 })], async (t) => {
    await t.cell(0, 1).waitFor();
    t.ok('a table never shows "+…", even on a cut-off cell', (await t.marks(t.el("tbl"))) === 0, String(await t.marks(t.el("tbl"))));
    const m = await t.measure(t.cell(0, 1));
    t.ok("its text keeps the table's size (24) and is clipped, not spilled", m.fontSize === 24 && m.cutOff && m.clipped, JSON.stringify(m));
    // Row 1 isn't taller than row 2: the text never stretches its row.
    const [top, bottom] = [await t.box(t.cell(0, 1)), await t.box(t.cell(1, 1))];
    t.ok("its row keeps its size", Math.abs(top.height - bottom.height) <= 2, JSON.stringify({ top, bottom }));
    const tbl = await t.box(t.el("tbl"));
    const scale = await t.scale();
    t.ok(
      "the table keeps its saved size",
      Math.abs(tbl.height - 200 * scale) <= 3 && Math.abs(tbl.width - 400 * scale) <= 3,
      JSON.stringify({ tbl, scale }),
    );
    await t.page.screenshot({ path: `${SHOTS}table-overflow-saved.png` });

    // Presenting: the same cell is still cut (same size), and no mark.
    await t.page.locator('button[title="Present (fullscreen)"]').first().click();
    await t.page.waitForFunction(() => document.documentElement.dataset.presenting === "true");
    const presenting = t.page.locator("div.fixed.inset-0.z-50");
    const shown = presenting.locator('[data-table-row="0"][data-table-column="1"]').first();
    await shown.waitFor();
    const pm = await t.measure(shown);
    t.ok("presenting: the cell is clipped too", pm.cutOff && pm.clipped, JSON.stringify(pm));
    t.ok("presenting: no mark", (await t.marks(presenting)) === 0);
    t.ok("presenting: the first line shows", (await shown.innerText()).startsWith("line 1"));
    await t.page.screenshot({ path: `${SHOTS}table-overflow-present.png` });
    await t.page.keyboard.press("Escape");
  });

  // ─── Typing past the bottom, then save and reload ──────────────────────────────────────────────────────────
  await scenario("typing past the bottom", [table("tbl", grid(3, 3), { width: 450, height: 180 })], async (t) => {
    await t.cell(1, 1).waitFor();
    const tableBefore = await t.box(t.el("tbl"));
    const cellsBefore = await Promise.all([[0, 0], [1, 0], [2, 2]].map(([r, c]) => t.box(t.cell(r, c))));
    await t.cell(1, 1).dblclick();
    await t.editable.waitFor();
    for (let i = 1; i <= 15; i++) {
      await t.page.keyboard.type(`row ${i}`);
      if (i < 15) await t.page.keyboard.press("Enter");
    }
    await t.page.waitForTimeout(300);
    t.ok("while typing: no mark", (await t.marks(t.el("tbl"))) === 0, String(await t.marks(t.el("tbl"))));
    t.ok("while typing the table keeps its size", JSON.stringify(await t.box(t.el("tbl"))) === JSON.stringify(tableBefore));
    await t.stopTyping();
    t.ok("after typing: no mark", (await t.marks(t.el("tbl"))) === 0);
    const cellsAfter = await Promise.all([[0, 0], [1, 0], [2, 2]].map(([r, c]) => t.box(t.cell(r, c))));
    t.ok("the other cells didn't move or grow", JSON.stringify(cellsAfter) === JSON.stringify(cellsBefore), JSON.stringify({ cellsBefore, cellsAfter }));
    const m = await t.measure(t.cell(1, 1));
    t.ok("the text keeps its size", m.fontSize === 24, JSON.stringify(m));
    // The start of the text shows again once typing stops (the box scrolled to the cursor while typing).
    t.ok("the cell shows its first line, not its last", (await t.cell(1, 1).innerText()).trim().startsWith("row 1"));

    await t.page.keyboard.press("Control+s");
    const allSaved = await t.waitForSaved((tables) => {
      const html = tables[0]?.table.rows[1][1].html ?? "";
      return html.includes("row 1") && html.includes("row 15");
    });
    t.ok("saved: every line, even the hidden ones", allSaved);
    const savedTable = (await t.saved())[0];
    t.ok("saved: the table's size didn't change", savedTable.width === 450 && savedTable.height === 180, `${savedTable.width}×${savedTable.height}`);

    await t.page.reload();
    await t.cell(1, 1).waitFor();
    await t.page.waitForTimeout(400);
    t.ok("after reload: still no mark", (await t.marks(t.el("tbl"))) === 0);
  });

  // ─── Long words, links and emoji stay inside their cell ────────────────────────────────────────────────────
  await scenario("long words and emoji", [table("tbl", grid(2, 3), { width: 600, height: 300 })], async (t) => {
    await t.cell(0, 0).waitFor();
    const URL_TEXT = "https://example.com/" + "a-very-long-path-without-spaces".repeat(6);
    const EMOJI = "😀🎉🍎".repeat(20);
    const DIGITS = "1234567890".repeat(15);
    await t.cell(0, 0).dblclick();
    await t.editable.waitFor();
    await t.page.keyboard.insertText(URL_TEXT);
    await t.page.keyboard.press("Tab");
    await t.page.keyboard.insertText(EMOJI);
    await t.page.keyboard.press("Tab");
    await t.page.keyboard.insertText(DIGITS);
    const typing = await t.measure(t.editable);
    t.ok("while typing a long number doesn't poke out sideways", !typing.pokesOut, JSON.stringify(typing));
    await t.stopTyping();
    for (const [column, what] of [[0, "a long link"], [1, "a row of emoji"], [2, "a long number"]]) {
      const m = await t.measure(t.cell(0, column));
      t.ok(`${what} stays inside its cell at full size`, !m.pokesOut && m.fontSize === 24, JSON.stringify(m));
    }
    const widths = await Promise.all([0, 1, 2].map(async (c) => (await t.box(t.cell(0, c))).width));
    t.ok("the columns keep equal widths", Math.max(...widths) - Math.min(...widths) <= 2, JSON.stringify(widths));
    await t.page.keyboard.press("Control+s");
    t.ok(
      "saved: the emoji whole",
      await t.waitForSaved((tables) => (tables[0]?.table.rows[0][1].html ?? "").includes(EMOJI)),
    );
    await t.page.screenshot({ path: `${SHOTS}table-overflow-words.png` });
  });

  // ─── Text that looks like code is shown as letters ─────────────────────────────────────────────────────────
  await scenario("text that looks like code", [table("tbl", grid(2, 2))], async (t) => {
    await t.cell(0, 0).waitFor();
    const CODE = `<script>alert("x")</script> <img src=x onerror=alert(1)> & "quotes" 'single'`;
    await t.cell(0, 0).dblclick();
    await t.editable.waitFor();
    await t.page.keyboard.insertText(CODE);
    await t.stopTyping();
    t.ok("the cell shows the letters as typed", (await t.cell(0, 0).innerText()).trim() === CODE, JSON.stringify(await t.cell(0, 0).innerText()));
    t.ok("no <img> or <script> was made", (await t.cell(0, 0).locator("img, script").count()) === 0);
    await t.page.keyboard.press("Control+s");
    t.ok(
      "saved escaped",
      await t.waitForSaved((tables) => {
        const html = tables[0]?.table.rows[0][0].html ?? "";
        return html.includes("&lt;script&gt;") && html.includes("&amp;") && !html.includes("<script");
      }),
      (await t.saved())[0]?.table.rows[0][0].html,
    );
    await t.page.reload();
    await t.cell(0, 0).waitFor();
    t.ok("after reload still letters", (await t.cell(0, 0).innerText()).trim() === CODE);
  });

  // ─── Saved HTML that would run something ───────────────────────────────────────────────────────────────────
  // A request edited by hand can save any HTML in a cell. Drawing it must never run it.
  const unsafe = table("tbl", [["", ""]]);
  unsafe.table.rows[0][0].html = `<p>hi<img src="x" onerror="window.__tableXss=1"></p>`;
  unsafe.table.rows[0][1].html = `<p>there</p><script>window.__tableXss=2</script><a href="javascript:window.__tableXss=3">link</a>`;
  await scenario("unsafe saved HTML", [unsafe], async (t) => {
    await t.cell(0, 0).getByText("hi").waitFor();
    await t.page.waitForTimeout(500);
    t.ok("no onerror ran", (await t.page.evaluate(() => window.__tableXss)) === undefined, String(await t.page.evaluate(() => window.__tableXss)));
    t.ok("no script tag in the cell", (await t.el("tbl").locator("script").count()) === 0);
    const hrefs = await t.el("tbl").locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    t.ok("no javascript: link", hrefs.every((h) => !h || !/^\s*javascript:/i.test(h)), JSON.stringify(hrefs));
  });

  // ─── Pasting: many lines, and past the 50,000 limit ────────────────────────────────────────────────────────
  await scenario("paste", [table("tbl", grid(3, 3), { width: 450, height: 180 })], async (t) => {
    await t.cell(0, 0).waitFor();
    const tableBefore = await t.box(t.el("tbl"));
    await t.cell(0, 0).dblclick();
    await t.editable.waitFor();
    await t.paste(Array.from({ length: 40 }, (_, i) => `pasted ${i + 1}`).join("\n"));
    await t.page.waitForTimeout(300);
    t.ok("a 40-line paste goes in", (await t.editable.innerText()).includes("pasted 40"));
    t.ok("the table keeps its size", JSON.stringify(await t.box(t.el("tbl"))) === JSON.stringify(tableBefore));
    t.ok("no mark", (await t.marks(t.el("tbl"))) === 0);

    // Past the limit: nothing changes, one toast says why.
    await t.page.keyboard.press("Tab");
    await t.page.keyboard.type("Keep");
    const toasts = t.page.locator("[data-sonner-toast]", { hasText: LIMIT_MESSAGE });
    await t.paste("x".repeat(50_000));
    await t.page.waitForTimeout(300);
    t.ok("a paste past 50,000 is refused", (await t.editable.innerText()).trim() === "Keep", `${(await t.editable.innerText()).length} characters`);
    t.ok("a toast says why", (await toasts.count()) === 1, String(await toasts.count()));
    // "&" is 5 characters as HTML (&amp;), so 10,000 of them is past the limit too.
    await t.paste("&".repeat(10_000));
    await t.page.waitForTimeout(300);
    t.ok("10,000 \"&\" are refused too", (await t.editable.innerText()).trim() === "Keep");
    await t.paste("y".repeat(20_000));
    await t.page.waitForTimeout(300);
    t.ok("a paste under the limit goes in", (await t.editable.innerText()).trim().length === 20_004, String((await t.editable.innerText()).trim().length));
    await t.stopTyping();
    await t.page.keyboard.press("Control+s");
    t.ok(
      "saved: both cells",
      await t.waitForSaved((tables) => {
        const rows = tables[0]?.table.rows;
        return !!rows && rows[0][0].html.includes("pasted 40") && rows[0][1].html.length > 20_000;
      }),
    );
    const otherErrors = t.page.locator("[data-sonner-toast][data-type=error]").filter({ hasNotText: LIMIT_MESSAGE });
    t.ok("no save error toast", (await otherErrors.count()) === 0, await otherErrors.allInnerTexts().then((x) => x.join(" | ")));
  });

  // ─── A huge text size, then back to small ──────────────────────────────────────────────────────────────────
  await scenario("huge text size", [table("tbl", grid(3, 3, () => "Hello world"), { width: 300, height: 150, fontSize: 96 })], async (t) => {
    await t.cell(0, 0).waitFor();
    await t.page.waitForTimeout(300);
    const m = await t.measure(t.cell(1, 1));
    t.ok("96 px text stays 96 px, never shrunk", m.fontSize === 96, JSON.stringify(m));
    t.ok("and doesn't poke out sideways (words break)", !m.pokesOut, JSON.stringify(m));
    t.ok("no mark on the cut-off cells", (await t.marks(t.el("tbl"))) === 0, String(await t.marks(t.el("tbl"))));
    await t.page.screenshot({ path: `${SHOTS}table-overflow-huge.png` });

    // Select the table and type 12 in the size box: everything fits again.
    await t.el("tbl").click();
    const size = t.page.locator('input[aria-label="Text size"]');
    await size.click();
    await size.fill("12");
    await t.page.keyboard.press("Enter");
    await t.page.waitForTimeout(400);
    const small = await t.measure(t.cell(1, 1));
    t.ok("size 12 goes to every cell", small.fontSize === 12, JSON.stringify(small));
    t.ok("at 12 px no cell is cut off", !small.cutOff, JSON.stringify(small));
    const shown = await t.box(t.el("tbl"));
    t.ok("the table kept its size", Math.abs(shown.width - 300 * (await t.scale())) <= 3, JSON.stringify(shown));

    // A typed size past the range is clamped (96 at most).
    await size.click();
    await size.fill("500");
    await t.page.keyboard.press("Enter");
    await t.page.keyboard.press("Control+s");
    t.ok("a typed 500 is saved as 96", await t.waitForSaved((tables) => tables[0]?.table.fontSize === 96), String((await t.saved())[0]?.table.fontSize));
  });

  // ─── The table made small under its text ───────────────────────────────────────────────────────────────────
  await scenario("shrunk under its text", [table("tbl", grid(2, 2, (r, c) => `cell ${r}${c}`), { width: 500, height: 200 })], async (t) => {
    await t.cell(0, 0).waitFor();
    t.ok("roomy: no mark", (await t.marks(t.el("tbl"))) === 0);
    await t.el("tbl").click();
    const before = await t.box(t.el("tbl"));
    await t.page.waitForTimeout(UNDO_STEP_MS);
    // The bottom-right "Resize" handle.
    const handles = await Promise.all((await t.page.locator('div[title="Resize"]').all()).map((h) => h.boundingBox()));
    const corner = handles.filter(Boolean).sort((p, q) => q.x + q.y - (p.x + p.y))[0];
    await t.drag(corner, -400, -160);
    await t.page.waitForTimeout(300);
    const after = await t.box(t.el("tbl"));
    t.ok("the table got much smaller", after.width < before.width / 2 && after.height < before.height / 2, JSON.stringify({ before, after }));
    const m = await t.measure(t.cell(0, 0));
    t.ok("its text keeps 24 px", m.fontSize === 24, JSON.stringify(m));
    t.ok("no mark on the cut-off cells", (await t.marks(t.el("tbl"))) === 0, String(await t.marks(t.el("tbl"))));
    await t.page.screenshot({ path: `${SHOTS}table-overflow-shrunk.png` });
    await t.page.waitForTimeout(UNDO_STEP_MS);
    await t.page.keyboard.press("Control+z");
    await t.page.waitForTimeout(300);
    t.ok("one undo puts the size back", JSON.stringify(await t.box(t.el("tbl"))) === JSON.stringify(before), JSON.stringify(await t.box(t.el("tbl"))));
  });

  // ─── At the limits: 15 × 15 and 1 × 1 ──────────────────────────────────────────────────────────────────────
  await scenario(
    "limits",
    [
      table("big", grid(15, 15, (r, c) => `${r * 15 + c}`), { x: 40, y: 40, width: 760, height: 640, fontSize: 12 }),
      table("one", [["only"]], { x: 900, y: 100, width: 200, height: 80 }),
      table("almost", grid(14, 2), { x: 900, y: 300, width: 300, height: 350, fontSize: 12 }),
    ],
    async (t) => {
      await t.el("big").locator("[data-table-row]").first().waitFor();
      t.ok("a 15 × 15 table opens with 225 cells", (await t.el("big").locator("[data-table-row]").count()) === 225);
      const plusRow = t.page.locator('button[title="Add a row"]');
      const plusColumn = t.page.locator('button[title="Add a column"]');
      const menuItem = (name) => t.page.getByRole("button", { name, exact: true });

      await t.el("big").click();
      await plusRow.or(t.page.locator('[data-element-toolbar] button[title="Table"]')).first().waitFor();
      t.ok("at 15 rows there's no row +", (await plusRow.count()) === 0);
      t.ok("at 15 columns there's no column +", (await plusColumn.count()) === 0);
      await t.page.locator('[data-element-toolbar] button[title="Table"]').click();
      for (const name of ["Add row above", "Add row below", "Add column left", "Add column right"]) {
        t.ok(`at 15 × 15 "${name}" is greyed out`, await menuItem(name).isDisabled());
      }
      t.ok("at 15 × 15 Delete row still works", !(await menuItem("Delete row").isDisabled()));
      await t.page.keyboard.press("Escape");
      await t.page.keyboard.press("Escape");

      // Tab from the last cell of a 15 × 15 stays there.
      await t.cell(14, 14, "big").dblclick();
      await t.editable.waitFor();
      await t.page.keyboard.press("Tab");
      t.ok("Tab on cell 225 stays there", (await t.editable.innerText()).trim() === "224");
      await t.stopTyping();
      await t.page.keyboard.press("Escape");

      await t.el("one").click();
      await t.page.locator('[data-element-toolbar] button[title="Table"]').click();
      t.ok("1 × 1: Delete row is greyed out", await menuItem("Delete row").isDisabled());
      t.ok("1 × 1: Delete column is greyed out", await menuItem("Delete column").isDisabled());
      t.ok("1 × 1: adding still works", !(await menuItem("Add row below").isDisabled()));
      await t.page.keyboard.press("Escape");
      // Delete on a picked cell of a 1 × 1 empties it but keeps the table. The first click selects the table, the
      // second (apart, so not a double-click) picks the cell; the menu then names it.
      await t.page.keyboard.press("Escape");
      await t.el("one").click();
      await t.page.waitForTimeout(UNDO_STEP_MS);
      await t.cell(0, 0, "one").click();
      await t.page.locator('[data-element-toolbar] button[title="Table"]').click();
      await t.page.getByText("Click a cell to choose another one.").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      t.ok("1 × 1: a click picks its only cell", (await t.page.getByText("Click a cell to choose another one.").count()) === 0);
      await t.page.locator('[data-element-toolbar] button[title="Table"]').click();
      await t.page.waitForTimeout(UNDO_STEP_MS);
      await t.page.keyboard.press("Delete");
      await t.page.waitForTimeout(200);
      const kept = await t.el("one").count();
      t.ok(
        "Delete on its only cell empties it and keeps the table",
        kept === 1 && (await t.cell(0, 0, "one").innerText()).trim() === "",
        kept ? JSON.stringify(await t.cell(0, 0, "one").innerText()) : "the table was deleted",
      );
      await t.page.keyboard.press("Escape");
      await t.page.keyboard.press("Escape");

      // 14 rows: one + reaches 15, then the + is gone.
      await t.el("almost").click();
      await plusRow.click();
      await t.page.waitForTimeout(200);
      t.ok("+ on 14 rows makes 15", (await t.el("almost").locator('[data-table-column="0"]').count()) === 15);
      t.ok("then the row + is gone", (await plusRow.count()) === 0);
      t.ok("the column + is still there", (await plusColumn.count()) === 1);

      await t.page.keyboard.press("Control+s");
      t.ok(
        "saved: 15 rows on the third table",
        await t.waitForSaved((tables) => tables.find((x) => x.id === "almost")?.table.rows.length === 15),
      );
    },
  );

  // ─── Broken saved tables ───────────────────────────────────────────────────────────────────────────────────
  // The database doesn't check a table's shape, so a request edited by hand could save one the editor can't make.
  // That table is left out when the presentation opens; the rest of the slide still opens.
  const sixteenRows = table("rows16", grid(16, 2), { x: 700, y: 50 });
  const uneven = table("uneven", [["a", "b"], ["c"]], { x: 700, y: 250 });
  const wrongSizes = table("sizes", grid(2, 2), { x: 700, y: 450, columnSizes: [1, 2, 3] });
  const badFill = table("tbl", [["red?", "plain"]], { x: 100, y: 100, width: 400, height: 100 });
  badFill.table.rows[0][0].fill = "url(https://example.com/x.png)";
  await scenario("broken saved tables", [badFill, sixteenRows, uneven, wrongSizes], async (t) => {
    await t.cell(0, 0).getByText("red?").waitFor();
    t.ok("the good table opens", true);
    for (const [id, what] of [["rows16", "16 rows"], ["uneven", "uneven rows"], ["sizes", "a size per column that doesn't match"]]) {
      t.ok(`a table with ${what} is left out`, (await t.el(id).count()) === 0);
    }
    const background = await t.cell(0, 0).evaluate((c) => getComputedStyle(c).backgroundImage + " " + getComputedStyle(c).backgroundColor);
    t.ok("an unsafe cell fill is dropped (no url in the background)", !background.includes("url("), background);
    // Typing and saving still works on the good table, and the save only holds valid tables.
    await t.cell(0, 1).dblclick();
    await t.editable.waitFor();
    await t.page.keyboard.press("End");
    await t.page.keyboard.type(" edited");
    await t.stopTyping();
    await t.page.keyboard.press("Control+s");
    t.ok(
      "saving works and keeps only the good table",
      await t.waitForSaved((tables) => tables.length === 1 && tables[0].table.rows[0][1].html.includes("plain edited")),
      JSON.stringify((await t.saved()).map((x) => x.id)),
    );
  });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
