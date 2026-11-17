// Claude's connector (src/pages/api/mcp.ts) and table cell colors: get_presentation_format tells Claude about a
// cell's "fill", send_presentation builds it (and refuses one that isn't a color), the draft opens in the editor
// with the colored cells, and read_presentation gives a saved cell's fill back so Claude can keep it.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, loginSession, makeTeacher } from "./lib.mjs";

const admin = await makeTeacher({ first: "Claude", admin: true });
const token = (await loginSession(admin)).access_token;

let requestId = 0;
/** One tool call on the connector, as Claude makes it: { text, isError }. */
async function callTool(name, args) {
  const res = await fetch(`${APP}/api/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json();
  if (!body.result) throw new Error(`${name}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return { text: body.result.content.map((part) => part.text ?? "").join("\n"), isError: !!body.result.isError };
}

const tableSlide = (rows) => ({ type: "blank", title: "Legs", elements: [{ asset: "table", table: { rows } }] });

const browser = await chromium.launch();
try {
  // The format tells Claude a cell can have its own background.
  const format = await callTool("get_presentation_format", {});
  check("the format names a cell's fill", /"fill"/.test(format.text.split("Tables (")[1]?.split("\n\n")[0] ?? ""));

  // A cell's fill that isn't a color the app can show is refused, with a reason.
  const bad = await callTool("send_presentation", {
    details: { title: "Bad fill" },
    slides: [tableSlide([[{ text: "Animal", fill: "url(https://evil.example/x.png)" }, "Legs"]])],
    final: false,
  });
  check("a fill that isn't a color is refused", bad.isError, bad.text.slice(0, 200));

  // A table whose header row has a soft background: built, and the draft opens with it.
  const sent = await callTool("send_presentation", {
    details: { title: "Cell fills from Claude" },
    slides: [
      tableSlide([
        [{ text: "**Animal**", fill: "#FFF9DB" }, { text: "**Legs**", fill: "#FFF9DB" }],
        ["Cat", { text: "4", fill: "gradient:#0CA678,#1971C2" }],
      ]),
    ],
    final: true,
  });
  check("send_presentation takes cell fills", !sent.isError, sent.text.slice(0, 300));
  const draftLink = sent.text.match(/https?:\/\/\S+\/presentation\/new\?draft=[0-9a-f-]+/)?.[0];
  check("send_presentation gives a draft link", !!draftLink, sent.text.slice(0, 200));

  if (draftLink) {
    const page = await (await loggedIn(browser, admin, { width: 1600, height: 1000 })).newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(`${APP}/presentation/new?draft=${draftLink.split("draft=")[1]}`, { timeout: 120_000 });
    const cell = (row, column) => page.locator(`[data-table-row="${row}"][data-table-column="${column}"]`).first();
    await cell(0, 0).waitFor();
    const look = (row, column) => cell(row, column).evaluate((el) => getComputedStyle(el).backgroundColor + "|" + getComputedStyle(el).backgroundImage);
    check("the draft's header cells have their fill", (await look(0, 0)).startsWith("rgb(255, 249, 219)") && (await look(0, 1)).startsWith("rgb(255, 249, 219)"), await look(0, 0));
    check("a gradient fill is drawn", (await look(1, 1)).includes("linear-gradient"), await look(1, 1));
    check("a cell without a fill stays plain", (await look(1, 0)).startsWith("rgba(0, 0, 0, 0)"), await look(1, 0));
    await page.screenshot({ path: SHOTS + "claude-table-fill.png" });
  }

  // read_presentation gives a saved cell's fill, so Claude can send it back.
  const savedId = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id: savedId, owner_id: admin.id, title: "Saved fills", data_version: 4 }),
  });
  const table = {
    id: "e1", assetId: "table", x: 100, y: 100, width: 400, height: 200, color: "#191A2C", containerId: null,
    table: { rows: [[{ html: "<p>Name</p>", fill: "#E7F5FF" }, { html: "<p>Score</p>" }]] },
  };
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify([{
      presentation_id: savedId, id: "s1", position: 0,
      data: { id: "s1", type: "blank", question: "", layout: "grid", options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: "" })), correctOptionId: null, elements: [table], questionHeight: 100 },
    }]),
  });
  const read = await callTool("read_presentation", { link: savedId });
  const json = JSON.parse(read.text.slice(read.text.indexOf("{")));
  const cells = json.slides[0].elements[0].table.rows[0];
  check("read_presentation gives a cell's fill", cells[0].fill === "#E7F5FF", JSON.stringify(cells));
  check("read_presentation gives no fill for a plain cell", !("fill" in cells[1]), JSON.stringify(cells));
  check("read_presentation still gives the cell's words", cells[0].html === "Name", JSON.stringify(cells));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
} finally {
  await browser.close();
  await deleteTeacher(admin);
}

finish();
