// Claude's connector finishes a checked draft without the slides being sent again (send_presentation with
// final: true, the draftId and no "slides"), and the format's JSON Schema is on one line (fewer tokens).
import { randomUUID } from "node:crypto";
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
  const schema = format.text.slice(format.text.indexOf('{"$schema"'));
  check("the format's schema is on one line", schema.length > 1000 && !schema.includes("\n"), schema.slice(0, 200));

  const slide = (n) => ({ type: "choice", question: `Question ${n}?`, options: ["A1", "B1", "C1", "D1"], answer: "A" });
  const checked = await callTool("send_presentation", { details: { title: "Finish me" }, final: false, slides: [slide(1), slide(2)] });
  check("the check send works", !checked.isError, checked.text.slice(0, 300));
  check("the check send has a layout report", checked.text.includes("Layout report"), checked.text.slice(0, 300));
  const draftId = checked.text.match(/Draft id: ([0-9a-f-]{36})/)?.[1];
  check("the check send gives a draft id", !!draftId, checked.text.slice(0, 300));

  const notChecking = await callTool("send_presentation", { final: false, draftId });
  check("no slides with final: false is refused", notChecking.isError, notChecking.text);

  const noId = await callTool("send_presentation", { final: true });
  check("no slides and no draftId is refused", noId.isError, noId.text);

  const gone = await callTool("send_presentation", { final: true, draftId: randomUUID() });
  check("an unknown draft is refused, asking for the slides", gone.isError && /send the slides again/i.test(gone.text), gone.text);

  const done = await callTool("send_presentation", { final: true, draftId });
  check("finishing without slides works", !done.isError, done.text);
  check("finishing gives the link", done.text.includes(`/presentation/new?draft=${draftId}`), done.text);
  check("finishing keeps the 2 slides", done.text.includes("(2 slides)"), done.text);
  check("finishing keeps the title", done.text.includes('"Finish me"'), done.text);

  const renamed = await callTool("send_presentation", { final: true, draftId, details: { title: "New name" } });
  check("details sent without slides replace the draft's", !renamed.isError && renamed.text.includes('"New name"'), renamed.text);
} finally {
  await deleteTeacher(admin);
}
finish();
