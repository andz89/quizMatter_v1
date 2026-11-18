// Claude's connector and text that never shrinks (src/lib/importText.ts): option rows are sized by their text and
// option text keeps its size (a "list" slide with a picture strip gives the options room from the strip, so the
// default size fits with no "+…" in the editor), and the layout report warns when Claude's own option size or a long
// question won't fit.
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, loginSession, makeTeacher } from "./lib.mjs";

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

const stripSlide = (extra = {}) => ({
  type: "choice",
  layout: "list",
  question: "Which one is a star?",
  options: ["Star", "Moon", "Sun", "Cloud"],
  answer: "A",
  elements: [{ asset: "star", in: "side" }],
  ...extra,
});

const browser = await chromium.launch();
try {
  const format = await callTool("get_presentation_format", {});
  check("the format says text never shrinks", format.text.includes("text never shrinks to fit its box"));
  check("the format says option rows are sized by their text", format.text.includes("Option rows are sized by their text"));
  check("the format no longer says options get smaller text", !format.text.includes("too short for one line"));

  // Claude's own option size too big for the rows under a strip it sized itself: the report says so.
  const big = await callTool("send_presentation", { details: { title: "Too big" }, slides: [stripSlide({ optionFontSize: 90, stripHeight: 160 })], final: false });
  check("Claude's 90px options under its own 160px strip are reported", !big.isError && /option A is probably too long .* cut off/.test(big.text), big.text.slice(0, 600));

  // A long question at its own height: reported.
  const long = await callTool("send_presentation", {
    details: { title: "Long question" },
    slides: [stripSlide({ question: "Which of these pictures shows the thing that shines at night far away in the sky, and why do you think so? Explain it.", questionHeight: 90 })],
    final: false,
  });
  check("a question too long for its height is reported", /the question is probably too long .* cut off/.test(long.text), long.text.slice(0, 600));

  // Left out: the options keep the default size, their rows make room, and the report is quiet about them.
  const sent = await callTool("send_presentation", { details: { title: "Fits" }, slides: [stripSlide()], final: true });
  check("the fitting slide is built", !sent.isError, sent.text.slice(0, 300));
  check("its options aren't reported", !/option [A-D] is probably too long/.test(sent.text), sent.text.slice(0, 600));
  const draftLink = sent.text.match(/https?:\/\/\S+\/presentation\/new\?draft=[0-9a-f-]+/)?.[0];
  if (draftLink) {
    const page = await (await loggedIn(browser, admin, { width: 1600, height: 1000 })).newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(`${APP}/presentation/new?draft=${draftLink.split("draft=")[1]}`, { timeout: 120_000 });
    await page.getByText("Moon").first().waitFor();
    await page.waitForTimeout(1000);
    const marks = await page.locator("[data-hidden-text-mark]").count();
    check("the draft shows no cut-off text", marks === 0, `${marks} marks`);
    const size = await page.locator("[data-container-id]").filter({ hasText: "Moon" }).locator('[style*="font-size"]').first()
      .evaluate((el) => getComputedStyle(el).fontSize);
    check("the options keep the default size (56 px)", size === "56px", size);
    await page.screenshot({ path: SHOTS + "claude-text-fit.png" });
  } else {
    check("send_presentation gives a draft link", false, sent.text.slice(0, 200));
  }
} finally {
  await browser.close();
  await deleteTeacher(admin);
}
finish();
