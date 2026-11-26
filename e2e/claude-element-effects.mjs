// Claude's connector (src/pages/api/mcp.ts) and element effects: get_presentation_format tells Claude about
// "effect", send_presentation builds it (the layout report counts the clicks, a question slide's is left out with a
// note) and the draft keeps it, and read_presentation gives a saved effect back as { type, step, speed }.
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

const box = (text, y, effect, group) => ({ text, position: { x: 100, y, width: 500, height: 60 }, ...(effect && { effect }), ...(group && { group }) });

const browser = await chromium.launch();
try {
  const format = await callTool("get_presentation_format", {});
  check("the format has a click-by-click section", format.text.includes("=== Click by click"), "");
  check("the format's schema has the effect's step", /"step"/.test(format.text), "");

  const sent = await callTool("send_presentation", {
    details: { title: "Click by click" },
    slides: [
      {
        type: "blank",
        title: "Parts of a plant",
        textBoxes: [
          box("Roots", 200, { type: "fade", step: 1 }),
          box("Stem", 300, { type: "pop", step: 2.4, speed: 9 }),
          box("Leaves", 400, { type: "fade", step: 5 }, "leaf"),
          box("make food", 460, undefined, "leaf"),
        ],
      },
      { type: "choice", question: "Which part holds the plant up?", options: ["Roots", "Stem", "Leaves", "Flower"], answer: "B", textBoxes: [{ ...box("Hint", 10, { type: "fade", step: 1 }), in: "side" }] },
    ],
    final: false,
  });
  check("send_presentation takes effects (small slips fixed)", !sent.isError, sent.text.slice(0, 400));
  check("the layout report counts 3 clicks", /Effects: 3 clicks/.test(sent.text), sent.text.slice(0, 1500));
  check("a question slide's effect is left out with a note", /"effect" only works on blank and title slides/.test(sent.text), "");
  const draftId = sent.text.match(/draftId[^0-9a-f]*([0-9a-f-]{36})/i)?.[1];
  check("the check gives a draft id", !!draftId, sent.text.slice(0, 300));

  // The draft opens in the editor with 3 steps: Roots, Stem (Pop up), then the "leaf" group as one.
  const done = await callTool("send_presentation", { final: true, draftId });
  const draftLink = done.text.match(/https?:\/\/\S+\/presentation\/new\?draft=[0-9a-f-]+/)?.[0];
  check("the final send gives the link", !!draftLink, done.text.slice(0, 300));
  if (draftLink) {
    const page = await (await loggedIn(browser, admin, { width: 1600, height: 1000 })).newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(`${APP}/presentation/new?draft=${draftLink.split("draft=")[1]}`, { timeout: 120_000 });
    await page.locator('button[title="Slide and element effects"]').first().click();
    await page.getByRole("tab", { name: "Element effects" }).click();
    const rows = page.locator("ol li");
    await rows.first().waitFor();
    const words = await rows.allTextContents();
    check("the draft's slide has 3 steps", words.length === 3, JSON.stringify(words));
    check("…step 2 pops up (Claude's 2.4 rounded)", words[1]?.includes("Pop up"), JSON.stringify(words));
    check("…step 3 is the whole group", /2 items/.test(words[2] ?? ""), JSON.stringify(words));
    await page.screenshot({ path: SHOTS + "claude-element-effects.png" });
  }

  // Saved as the app saves it: read back through read_presentation in the recipe's words.
  const savedId = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id: savedId, owner_id: admin.id, title: "Saved effects", data_version: 7 }),
  });
  const text = (id, order, type = "fade") => ({
    id, assetId: "text-box", x: 100, y: 100, width: 400, height: 60, color: "#191A2C", containerId: null,
    text: { html: `<p>${id}</p>` }, ...(order && { effect: { type, order, speed: 4 } }),
  });
  const slideData = (id, type, elements) => ({
    id, type, question: "", layout: "grid", options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: "" })),
    correctOptionId: null, elements, questionHeight: 100,
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify([
      { presentation_id: savedId, id: "s1", position: 0, data: slideData("s1", "blank", [text("first", 3), text("second", 8, "pop"), text("plain")]) },
      { presentation_id: savedId, id: "s2", position: 1, data: slideData("s2", "choice", [text("ignored", 1)]) },
    ]),
  });
  const read = await callTool("read_presentation", { link: savedId });
  const json = JSON.parse(read.text.slice(read.text.indexOf("{")));
  const [first, second, plain] = json.slides[0].elements;
  check("read_presentation gives the step, not the saved order", JSON.stringify(first.effect) === JSON.stringify({ type: "fade", step: 1, speed: 4 }), JSON.stringify(first.effect));
  check("…the next one is step 2", second.effect?.step === 2 && second.effect?.type === "pop", JSON.stringify(second.effect));
  check("a piece without an effect has none", !("effect" in plain), JSON.stringify(plain));
  check("a question slide's saved effect isn't given", !("effect" in json.slides[1].elements[0]), JSON.stringify(json.slides[1].elements[0]));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
} finally {
  await browser.close();
  await deleteTeacher(admin);
}

finish();
