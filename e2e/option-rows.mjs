// Option row heights (spec: docs/superpowers/specs/2026-11-18-option-row-heights-design.md): the lines between list
// rows share room, Shuffle keeps a list row with its option and fits a grid's rows again (never changing a size),
// rows never pass the options area's bottom, an option with a picture keeps room for it, a click on an option's "+…"
// makes its text just small enough to show, and presenting draws the same rows.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const LONG_A =
  "Dance provides active bodily immersion and emotional connection through rhythm, whereas visual arts provide permanent visual storytelling, both complementing each other to preserve heritage.";
const LONG_C = "Both together: a dance tells the legend in the moment, and a mural keeps the same story where people pass by it every day.";
const MARK = "[data-hidden-text-mark]";

const teacher = await makeTeacher({ first: "Option", last: "Rows" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Option rows e2e", data_version: 6 }),
});
const slide = (id, position, layout, options, extra = {}) => ({
  presentation_id: presentationId,
  id,
  position,
  data: {
    id,
    type: "choice",
    question: "Which art form keeps the legends alive?",
    layout,
    options: options.map((o, i) => ({ id: `${id}-${"abcd"[i]}`, ...o })),
    correctOptionId: `${id}-a`,
    elements: [],
    questionHeight: 100,
    ...extra,
  },
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([
    // Your Q16: A long and small, the others short.
    slide("s1", 0, "list", [{ text: LONG_A, fontSize: 30 }, { text: "Visual arts" }, { text: "Dance" }, { text: "Neither" }]),
    // Text far too big for the room.
    slide("s2", 1, "list", [LONG_A, LONG_A, LONG_A, LONG_A].map((text) => ({ text, fontSize: 60 }))),
    // Grid with the two long options in the left column.
    slide("s3", 2, "grid", [{ text: LONG_C, fontSize: 30 }, { text: "Murals", fontSize: 30 }, { text: LONG_C, fontSize: 30 }, { text: "Sculptures", fontSize: 30 }]),
    // A short option with a tall picture.
    slide("s4", 3, "grid", [{ text: "Star" }, { text: "Moon" }, { text: LONG_A, fontSize: 30 }, { text: "D" }], {
      elements: [{ id: "pic", assetId: "star", x: 300, y: 4, width: 100, height: 100, color: "#FFC233", containerId: "s4-a" }],
    }),
    // A list option whose text is cut off at the default size: a click on its "+…" makes it fit.
    slide("s6", 5, "list", [{ text: LONG_A + " " + LONG_A }, { text: "B" }, { text: "C" }, { text: "D" }]),
    // A question cut off at its own size: a click on its "+…" makes it fit.
    slide("s7", 6, "list", [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }], { question: LONG_A + " " + LONG_C, questionFontSize: 44 }),
    // "+…" only when letters are cut, and the grow mark on room to spare.
    slide("s8", 7, "list", [
      { text: "It removes visual variety, making all craft items look uniform.", fontSize: 40 },
      { text: "Sun", fontSize: 30 },
      { text: "C", fontSize: 40 },
      { text: "D", fontSize: 40 },
    ]),
    // The user's long question at several sizes: wherever the grow mark shows, its click must make the text bigger.
    ...[22, 24, 26, 28, 30].map((size, i) =>
      slide(`q${size}`, 20 + i, "list", [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }], {
        question:
          "A festival contingent in Surigao decides to replace their traditional bamboo percussion and brass gongs with pre-recorded modern electronic synthesizer music. Evaluating this choice in terms of preserving authentic Surigaonon cultural soundscapes, which critique is most valid?",
        questionFontSize: size,
        questionHeight: 160,
      }),
    ),
    // Text boxes: one cut off, one with room.
    {
      presentation_id: presentationId,
      id: "tb",
      position: 30,
      data: {
        id: "tb", type: "blank", question: "", layout: "grid", correctOptionId: null, questionHeight: 100,
        options: ["a", "b", "c", "d"].map((o) => ({ id: `tb-${o}`, text: "" })),
        elements: [
          { id: "tb-long", assetId: "text-box", x: 100, y: 100, width: 400, height: 90, color: "#1B1530", containerId: null, text: { html: `<p>${LONG_C}</p>`, fontSize: 40 } },
          { id: "tb-short", assetId: "text-box", x: 700, y: 100, width: 400, height: 200, color: "#1B1530", containerId: null, text: { html: "<p>Sun</p>", fontSize: 24 } },
          // Turned upside down: its hidden lines are drawn above it on screen, yet it's still cut off.
          { id: "tb-turned", assetId: "text-box", x: 100, y: 400, width: 400, height: 90, rotation: 180, color: "#1B1530", containerId: null, text: { html: `<p>${LONG_C}</p>`, fontSize: 40 } },
          // Already at the biggest size, with room: no grow mark (its click could give nothing).
          // The user's small text box: the grow mark used to cover it and its handles.
          { id: "tb-small", assetId: "text-box", x: 1150, y: 20, width: 60, height: 60, color: "#1B1530", containerId: null, text: { html: "<p>A</p>", fontSize: 16 } },
          // A small one at the slide's right edge: its mark sits above it, lined up, not cut off.
          { id: "tb-edge", assetId: "text-box", x: 1215, y: 200, width: 60, height: 60, color: "#1B1530", containerId: null, text: { html: "<p>B</p>", fontSize: 16 } },
          { id: "tb-max", assetId: "text-box", x: 700, y: 380, width: 500, height: 300, color: "#1B1530", containerId: null, text: { html: "<p>Hi</p>", fontSize: 96 } },
        ],
      },
    },
    // Empty options (a new slide): no grow mark on the placeholder.
    slide("empty", 31, "list", [{ text: "" }, { text: "" }, { text: "" }, { text: "" }]),
    // A list option with a tall picture: a drag line stops at it.
    slide("s5", 4, "list", [{ text: "Sun" }, { text: "B" }, { text: "C" }, { text: "D" }], {
      elements: [{ id: "pic5", assetId: "star", x: 300, y: 4, width: 90, height: 90, color: "#FFC233", containerId: "s5-a" }],
    }),
  ]),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const near = (a, b, by) => Math.abs(a - b) <= by;

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const item = (id) => page.locator(`[data-slide-id="${id}"]`);
  const option = (id) => page.locator(`[data-container-id="${id}"]`);
  const box = async (id) => (await option(id).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const fontSize = (id) => option(id).locator('[style*="font-size"]').first().evaluate((el) => getComputedStyle(el).fontSize);
  const grid = (id) => item(id).locator('[style*="grid-template-rows"]').first();
  const shuffle = async (id) => {
    await item(id).scrollIntoViewIfNeeded();
    await item(id).getByTitle("Shuffle options").click();
    await page.waitForTimeout(400);
  };
  await item("s1").waitFor();
  await page.waitForTimeout(800);

  // ─── List: no Fit button (grid only), the lines show ─────────────────────────────────────────────────────
  await item("s1").scrollIntoViewIfNeeded();
  check("no slide has a Fit rows to text button", (await page.getByTitle("Fit rows to text").count()) === 0);
  check("a list slide shows a line between each pair of rows", (await item("s1").getByRole("separator").count()) === 3);
  const sizesBefore = await Promise.all(["s1-a", "s1-b", "s1-c", "s1-d"].map(fontSize));

  // ─── List: a drag line ──────────────────────────────────────────────────────────────────────────────────
  const line = item("s1").getByRole("separator").first();
  const lineBox = await line.boundingBox();
  const bBefore = (await box("s1-b")).height;
  const aBefore = (await box("s1-a")).height;
  await page.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const aGrew = (await box("s1-a")).height - aBefore;
  const bShrank = bBefore - (await box("s1-b")).height;
  check("dragging the line grows A and shrinks B by the same amount", aGrew > 5 && near(aGrew, bShrank, 1), `${aGrew} / ${bShrank}`);
  const sizesAfter = await Promise.all(["s1-a", "s1-b", "s1-c", "s1-d"].map(fontSize));
  check("dragging changes no text size", JSON.stringify(sizesBefore) === JSON.stringify(sizesAfter), `${sizesBefore} → ${sizesAfter}`);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check("one undo puts the drag back", near((await box("s1-a")).height, aBefore, 1), `${(await box("s1-a")).height} vs ${aBefore}`);

  // ─── List: Shuffle keeps a row with its option ─────────────────────────────────────────────────────────
  const aHeight = (await box("s1-a")).height;
  await item("s1").getByTitle("Shuffle options").click();
  await page.waitForTimeout(400);
  check("after Shuffle, A keeps its tall row", near((await box("s1-a")).height, aHeight, 1), `${(await box("s1-a")).height} vs ${aHeight}`);

  // ─── Text too big: rows stay inside, +… shows, sizes untouched ─────────────────────────────────────────
  await item("s2").scrollIntoViewIfNeeded();
  const area = await grid("s2").boundingBox();
  const last = await box("s2-d");
  check("too-big text: the rows end inside the options area", last.y + last.height <= area.y + area.height + 1, `${last.y + last.height} vs ${area.y + area.height}`);
  check("too-big text: +… shows", (await item("s2").locator(MARK).count()) > 0);
  // The "+…" mark hangs into the gap where a line is: the mark stays on top (its tip shows, a press reaches it).
  const markOnTop = await item("s2").locator(MARK).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height * 0.85);
    return !!hit && (el === hit || el.contains(hit));
  });
  check("a row line doesn't cover the +… mark", markOnTop);
  check("too-big text: the size stays 60 px", (await fontSize("s2-a")) === "60px", await fontSize("s2-a"));

  // ─── Grid: rows fitted again after Shuffle, both columns end together ──────────────────────────────────
  const gridSizesBefore = await Promise.all(["s3-a", "s3-b", "s3-c", "s3-d"].map(fontSize));
  await shuffle("s3");
  const gridSizesAfter = await Promise.all(["s3-a", "s3-b", "s3-c", "s3-d"].map(fontSize));
  check("a grid's re-fit after Shuffle changes no text size", JSON.stringify(gridSizesBefore) === JSON.stringify(gridSizesAfter), `${gridSizesBefore} → ${gridSizesAfter}`);
  const sameEnd = async () => {
    const ids = ["s3-a", "s3-b", "s3-c", "s3-d"];
    const boxes = await Promise.all(ids.map(box));
    const left = boxes.filter((b) => near(b.x, Math.min(...boxes.map((x) => x.x)), 2));
    const right = boxes.filter((b) => !left.includes(b));
    const end = (bs) => Math.max(...bs.map((b) => b.y + b.height));
    return { ok: near(end(left), end(right), 1), detail: `${end(left)} vs ${end(right)}` };
  };
  let ends = await sameEnd();
  check("grid: both columns end together after a Shuffle", ends.ok, ends.detail);
  for (let i = 0; i < 3; i++) {
    await item("s3").getByTitle("Shuffle options").click();
    await page.waitForTimeout(300);
    ends = await sameEnd();
    check(`grid: both columns end together after Shuffle ${i + 1}`, ends.ok, ends.detail);
  }
  const gridArea = await grid("s3").boundingBox();
  const lowest = Math.max(...(await Promise.all(["s3-a", "s3-b", "s3-c", "s3-d"].map(box))).map((b) => b.y + b.height));
  check("grid: nothing runs past the options area", lowest <= gridArea.y + gridArea.height + 1);
  check("grid has no drag lines", (await item("s3").getByRole("separator").count()) === 0);

  // ─── An option with a picture keeps room for it ────────────────────────────────────────────────────────
  await shuffle("s4");
  const row = await box("s4-a");
  const pic = await item("s4").locator('[data-element-id="pic"]').boundingBox();
  check("a picture's row is never shorter than its picture", pic && pic.y + pic.height <= row.y + row.height + 1, pic && `${pic.y + pic.height} vs ${row.y + row.height}`);

  // ─── A click on an option's "+…" makes its text just small enough to show ────────────────────────────────
  await item("s6").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const mark6 = option("s6-a").locator(MARK);
  check("a cut-off option shows +…", (await mark6.count()) === 1);
  check("its +… says a click makes the text fit", ((await mark6.getAttribute("title")) ?? "").includes("Click to make the text smaller"));
  const others6 = await Promise.all(["s6-b", "s6-c", "s6-d"].map(fontSize));
  await mark6.click();
  await page.waitForTimeout(400);
  const fitted = Number.parseFloat(await fontSize("s6-a"));
  check("the click makes that option's text smaller", fitted < 56, String(fitted));
  check("then all of it shows (no +…)", (await option("s6-a").locator(MARK).count()) === 0);
  check("only that option changed", JSON.stringify(await Promise.all(["s6-b", "s6-c", "s6-d"].map(fontSize))) === JSON.stringify(others6));
  await page.waitForTimeout(1200);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  check("one undo puts the size back", (await fontSize("s6-a")) === "56px", await fontSize("s6-a"));

  // ─── The same for the question ───────────────────────────────────────────────────────────────────────────
  await item("s7").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const question = item("s7").locator('[data-container-id="question"]');
  const questionSize = () => question.locator('[style*="font-size"]').first().evaluate((el) => getComputedStyle(el).fontSize);
  const qMark = question.locator(MARK);
  check("a cut-off question shows +…", (await qMark.count()) === 1);
  const optionSizes7 = await Promise.all(["s7-a", "s7-b", "s7-c", "s7-d"].map(fontSize));
  await qMark.click();
  await page.waitForTimeout(400);
  const qFitted = Number.parseFloat(await questionSize());
  check("the click makes the question's text smaller", qFitted < 44, String(qFitted));
  check("then all of the question shows (no +…)", (await question.locator(MARK).count()) === 0);
  check("the options' sizes didn't change", JSON.stringify(await Promise.all(["s7-a", "s7-b", "s7-c", "s7-d"].map(fontSize))) === JSON.stringify(optionSizes7));
  await page.waitForTimeout(1200);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  check("one undo puts the question's size back", (await questionSize()) === "44px", await questionSize());

  // A mark is fully above the box (so it covers no text and no handle), its right edge lined up with the box's.
  const outside = async (mark, box) => {
    const [m, b] = [await mark.boundingBox(), await box.boundingBox()];
    return !!m && !!b && m.y + m.height <= b.y && Math.abs(m.x + m.width - (b.x + b.width)) <= 2;
  };
  // The same, under the box (a text box at the slide's top edge).
  const under = async (mark, box) => {
    const [m, b] = [await mark.boundingBox(), await box.boundingBox()];
    return !!m && !!b && m.y >= b.y + b.height && Math.abs(m.x + m.width - (b.x + b.width)) <= 2;
  };
  // Nothing covers or cuts off the mark: the point at its middle is the mark itself.
  const seen = (mark) =>
    mark.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });

  // ─── "+…" only when letters are cut; the grow mark where there's room ────────────────────────────────────
  await item("s8").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const textA = option("s8-a").locator('[style*="font-size"]').first();
  const cutOf = () => textA.evaluate((el) => el.scrollHeight - el.clientHeight);
  const line8 = item("s8").getByRole("separator").first();
  // Squeeze A's row 1 px at a time (zoom-free: the line's own keys move 6 slide px), until only the empty room under
  // "uniform." (no g, y, p…) is cut, then on into the letters.
  let sawEmptyCut = false;
  let sawLetterCut = false;
  await line8.focus();
  for (let i = 0; i < 25 && !sawLetterCut; i++) {
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    const cut = await cutOf();
    const marks = await option("s8-a").locator(MARK).count();
    if (cut >= 2 && cut <= 7 && !sawEmptyCut) {
      sawEmptyCut = true;
      check(`cutting only the room under "uniform." shows no +… (${cut} px)`, marks === 0);
    }
    if (cut >= 12) {
      sawLetterCut = true;
      check(`cutting into the letters shows +… (${cut} px)`, marks === 1);
    }
  }
  check("the squeeze reached both cases", sawEmptyCut && sawLetterCut);
  // The grow mark: shown on hover where there's room, makes the text as big as still fits.
  const grow = option("s8-b").locator("[data-grow-text-mark]");
  await option("s8-b").hover();
  await page.waitForTimeout(200);
  check("a short option with room shows the grow mark on hover", (await grow.count()) === 1 && (await grow.evaluate((el) => getComputedStyle(el).opacity)) === "1");
  // Every option's and the question's text leaves room above it for a mark (its 12 px gap + the grow mark's 38 px).
  const roomy = await item("s8").evaluate((slide) => {
    const sr = slide.querySelector("[data-container-id]").closest(".overflow-hidden")?.getBoundingClientRect() ?? slide.getBoundingClientRect();
    const zoom = slide.querySelector("[data-container-id]").getBoundingClientRect().width / slide.querySelector("[data-container-id]").offsetWidth;
    return [...slide.querySelectorAll("[data-container-id] [style*='font-size']")].map((el) => {
      const r = el.getBoundingClientRect();
      return (r.top - sr.top) / zoom;
    });
  });
  check("every option and the question have room for their marks outside", roomy.length >= 5 && roomy.every((r) => r >= 50), roomy.map(Math.round).join(", "));
  check("the grow mark sits outside the option, not cut off", (await outside(grow, option("s8-b"))) && (await seen(grow)));
  await grow.click();
  await page.waitForTimeout(400);
  const grown = Number.parseFloat(await fontSize("s8-b"));
  check("a click on it makes the text bigger", grown > 30, String(grown));
  check("and all of it still shows (no +…)", (await option("s8-b").locator(MARK).count()) === 0);
  const unbroken = await option("s8-b").locator('[style*="font-size"]').first().evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...r.getClientRects()].filter((x) => x.width > 0).length <= 2;
  });
  check("its word isn't broken onto two lines", unbroken);
  check("the other options' sizes didn't change", (await fontSize("s8-c")) === "40px" && (await fontSize("s8-d")) === "40px");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  check("one undo puts it back to 30 px", (await fontSize("s8-b")) === "30px", await fontSize("s8-b"));

  // ─── The grow mark never offers a size its click can't give ──────────────────────────────────────────────
  let offered = 0;
  for (const size of [22, 24, 26, 28, 30]) {
    const q = item(`q${size}`).locator('[data-container-id="question"]');
    await item(`q${size}`).scrollIntoViewIfNeeded();
    await q.hover();
    await page.waitForTimeout(250);
    const growMark = q.locator("[data-grow-text-mark]");
    if ((await growMark.count()) === 0) continue;
    offered++;
    await growMark.click();
    await page.waitForTimeout(400);
    const after = Number.parseFloat(await q.locator('[style*="font-size"]').first().evaluate((el) => getComputedStyle(el).fontSize));
    check(`question at ${size} px: the grow mark's click makes it bigger and it still fits`, after > size && (await q.locator(MARK).count()) === 0, `${size} → ${after}`);
  }
  check("the grow mark showed on at least one of them", offered > 0, String(offered));

  // ─── Text boxes too ──────────────────────────────────────────────────────────────────────────────────────
  await item("tb").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const tbLong = item("tb").locator('[data-element-id="tb-long"]');
  const tbShort = item("tb").locator('[data-element-id="tb-short"]');
  const tbSize = (loc) => loc.locator('[style*="font-size"]').first().evaluate((el) => getComputedStyle(el).fontSize);
  check("a cut-off text box shows +…", (await tbLong.locator(MARK).count()) === 1);
  check("+… sits outside the text box, not cut off", (await outside(tbLong.locator(MARK), tbLong)) && (await seen(tbLong.locator(MARK))));
  await tbLong.locator(MARK).click();
  await page.waitForTimeout(400);
  const tbFitted = Number.parseFloat(await tbSize(tbLong));
  check("a click on it makes the text box's text smaller, and all of it shows", tbFitted < 40 && (await tbLong.locator(MARK).count()) === 0, String(tbFitted));
  check("a text box with room shows no grow mark until it's selected", (await tbShort.locator("[data-grow-text-mark]").count()) === 0);
  await tbShort.click();
  await page.waitForTimeout(300);
  const tbGrow = tbShort.locator("[data-grow-text-mark]");
  check("selected, it shows the grow mark", (await tbGrow.count()) === 1);
  await tbGrow.click();
  await page.waitForTimeout(400);
  const tbGrown = Number.parseFloat(await tbSize(tbShort));
  check("a click on it makes the text box's text bigger, still whole", tbGrown > 24 && (await tbShort.locator(MARK).count()) === 0, String(tbGrown));
  await page.keyboard.press("Escape");
  // A small text box: the mark sits outside it and clear of its corner handle, and still works.
  const tbSmall = item("tb").locator('[data-element-id="tb-small"]');
  await tbSmall.click();
  await page.waitForTimeout(300);
  const smallGrow = tbSmall.locator("[data-grow-text-mark]");
  check("a small text box shows the grow mark when selected", (await smallGrow.count()) === 1);
  check("at the slide's top edge it sits under the small box, not cut off by the slide", (await under(smallGrow, tbSmall)) && (await seen(smallGrow)));
  const handleClear = async () => {
    const [m, h] = [await smallGrow.boundingBox(), await item("tb").locator('[title="Resize"]').last().boundingBox()];
    return !!m && !!h && m.y >= h.y + h.height;
  };
  check("it doesn't cover the corner handle", await handleClear());
  await smallGrow.click();
  await page.waitForTimeout(400);
  check("its click makes the small box's text bigger", Number.parseFloat(await tbSize(tbSmall)) > 16, await tbSize(tbSmall));
  await page.keyboard.press("Escape");
  const tbEdge = item("tb").locator('[data-element-id="tb-edge"]');
  await tbEdge.click();
  await page.waitForTimeout(300);
  const edgeGrow = tbEdge.locator("[data-grow-text-mark]");
  check("at the slide's right edge the mark sits above the box, lined up, not past the slide", await outside(edgeGrow, tbEdge));
  check("and it isn't cut off by the slide", await seen(edgeGrow));
  await page.keyboard.press("Escape");
  check("a turned text box that's cut off still shows +…", (await item("tb").locator('[data-element-id="tb-turned"]').locator(MARK).count()) === 1);
  await item("tb").locator('[data-element-id="tb-max"]').click();
  await page.waitForTimeout(300);
  check("a text box already at 96 px shows no grow mark", (await item("tb").locator('[data-element-id="tb-max"] [data-grow-text-mark]').count()) === 0);
  await page.keyboard.press("Escape");
  await item("empty").scrollIntoViewIfNeeded();
  await option("empty-a").hover();
  await page.waitForTimeout(300);
  check("an empty option shows no grow mark", (await option("empty-a").locator("[data-grow-text-mark]").count()) === 0);

  await page.screenshot({ path: `${SHOTS}/option-rows-editor.png` });

  // ─── A drag line stops at a picture, and sits in the middle of the real gap ────────────────────────────
  await item("s5").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const pic5 = item("s5").locator('[data-element-id="pic5"]');
  // Like the question box: the text spans the whole option, and the picture sits on top of it.
  const card5 = await box("s5-a");
  const text5 = await option("s5-a").locator('[style*="font-size"]').first().boundingBox();
  check("an option with a picture keeps its text full width", text5.width > card5.width * 0.9, `${text5.width} of ${card5.width}`);
  const onTop = await pic5.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
  check("the picture sits on top of the option's text", onTop);
  const picBefore = await pic5.boundingBox();
  const line5 = await item("s5").getByRole("separator").first().boundingBox();
  const aBox = await box("s5-a");
  const bBox = await box("s5-b");
  const gapMiddle = (aBox.y + aBox.height + bBox.y) / 2;
  check("the line sits in the middle of the gap between the rows", near(line5.y + line5.height / 2, gapMiddle, 1.5), `${line5.y + line5.height / 2} vs ${gapMiddle}`);
  // Arrow keys on a focused line move the line only, never a selected picture.
  await pic5.click();
  const picPicked = await pic5.boundingBox();
  const rowBeforeKeys = (await box("s5-a")).height;
  await item("s5").getByRole("separator").first().focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  const picAfterKeys = await pic5.boundingBox();
  check("ArrowDown on a line leaves a selected picture where it was", near(picAfterKeys.y, picPicked.y, 0.5) && near(picAfterKeys.x, picPicked.x, 0.5), `${picPicked.y} → ${picAfterKeys.y}`);
  check("ArrowDown on a line moves the line", (await box("s5-a")).height > rowBeforeKeys + 2, `${rowBeforeKeys} → ${(await box("s5-a")).height}`);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(300);
  await page.mouse.move(line5.x + line5.width / 2, line5.y + line5.height / 2);
  await page.mouse.down();
  await page.mouse.move(line5.x + line5.width / 2, line5.y - 150, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const picAfter = await pic5.boundingBox();
  const rowAfter = await box("s5-a");
  check("dragging up stops at the picture: it isn't squeezed", near(picAfter.height, picBefore.height, 0.5), `${picBefore.height} → ${picAfter.height}`);
  check("the row still holds the whole picture", picAfter.y + picAfter.height <= rowAfter.y + rowAfter.height + 1);

  // ─── Save, reload, present: the same rows ──────────────────────────────────────────────────────────────
  const editorRows = await grid("s1").getAttribute("style");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(2500);
  await page.reload();
  await item("s1").waitFor();
  await page.waitForTimeout(800);
  check("after reload, the rows are as saved", (await grid("s1").getAttribute("style")) === editorRows);
  await item("s1").click({ position: { x: 5, y: 5 } });
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await page.waitForTimeout(1500);
  const presented = await page.evaluate(() =>
    [...document.querySelectorAll('[style*="grid-template-rows"]')].map((el) => el.getAttribute("style")),
  );
  const rowsOf = (style) => /grid-template-rows:\s*([^;]+)/.exec(style ?? "")?.[1]?.trim();
  check("presenting draws the same rows as the editor", presented.some((s) => rowsOf(s) === rowsOf(editorRows)), `${rowsOf(editorRows)}`);
  await page.screenshot({ path: `${SHOTS}/option-rows-present.png` });

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
