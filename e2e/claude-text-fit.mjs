// Claude's connector and text that never shrinks (src/lib/importText.ts): a "list" slide with a picture strip gets
// options small enough for its short rows (no "+…" in the editor), and the layout report warns when Claude's own
// option size or a long question won't fit.
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
  check("the format says short option rows get smaller text", format.text.includes("too short for one line"));

  // Claude's own option size too big for the short rows: the report says so.
  const big = await callTool("send_presentation", { details: { title: "Too big" }, slides: [stripSlide({ optionFontSize: 56 })], final: false });
  check("Claude's 56px options in short rows are reported", !big.isError && /option A is probably too long .* cut off/.test(big.text), big.text.slice(0, 600));

  // A long question at its own height: reported.
  const long = await callTool("send_presentation", {
    details: { title: "Long question" },
    slides: [stripSlide({ question: "Which of these pictures shows the thing that shines at night far away in the sky, and why do you think so? Explain it.", questionHeight: 90 })],
    final: false,
  });
  check("a question too long for its height is reported", /the question is probably too long .* cut off/.test(long.text), long.text.slice(0, 600));

  // Left out: the options get a size that fits, and the report is quiet about them.
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
    await page.screenshot({ path: SHOTS + "claude-text-fit.png" });
  } else {
    check("send_presentation gives a draft link", false, sent.text.slice(0, 200));
  }
} finally {
  await browser.close();
  await deleteTeacher(admin);
}
finish();
