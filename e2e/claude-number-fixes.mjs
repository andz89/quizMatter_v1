// Claude's connector pulls a slightly-out-of-range size into range instead of refusing the whole presentation
// (src/lib/importPresentation.ts, `fitted`): a 12 px tall arrow, a 10 px table text, a "stripHeight" or
// "questionHeight" taller than the slide allows. The too-tall ones are named in the layout report.
import { APP, check, deleteTeacher, finish, loginSession, makeTeacher } from "./lib.mjs";

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

try {
  const format = await callTool("get_presentation_format", {});
  check("the format still shows a position's smallest height", /"height":\s*\{[^}]*"minimum":\s*20/.test(format.text));

  const sent = await callTool("send_presentation", {
    details: { title: "Number fixes" },
    final: false,
    slides: [
      {
        type: "blank",
        title: "Arrows",
        elements: [
          { asset: "line-arrow", position: { x: 100, y: 300, width: 200, height: 12 } },
          { asset: "line-arrow", position: { x: 400, y: 300, width: 200.6, height: 8 } },
        ],
      },
      { type: "blank", title: "Legs", elements: [{ asset: "table", table: { rows: [["Cat", "4"], ["Bird", "2"]], fontSize: 10 } }] },
      {
        type: "choice",
        layout: "list",
        question: "Which one is a star?",
        options: ["Star", "Moon", "Sun", "Cloud"],
        answer: "A",
        elements: [{ asset: "star", in: "side" }],
        stripHeight: 600,
      },
      { type: "short-answer", question: "Name a star.", answer: "Sun", questionHeight: 400 },
    ],
  });
  check("the presentation is built, not sent back", !sent.isError, sent.text.slice(0, 600));
  check("the report names the lowered strip", /"stripHeight" 600 is more than this slide allows, so it was lowered to \d+/.test(sent.text), sent.text);
  check("the report names the lowered question box", /"questionHeight" 400 is more than this slide allows, so it was lowered to \d+/.test(sent.text), sent.text);

  // Out-of-range text that isn't a number is still refused.
  const bad = await callTool("send_presentation", {
    details: { title: "Bad" },
    final: false,
    slides: [{ type: "blank", title: "Legs", elements: [{ asset: "table", table: { rows: [["Cat", "4"]], fontSize: "big" } }] }],
  });
  check("a font size that isn't a number is still refused", bad.isError, bad.text.slice(0, 200));
} finally {
  await deleteTeacher(admin);
}
finish();
