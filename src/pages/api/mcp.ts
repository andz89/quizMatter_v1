import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { buildSlides, getClaudeFormat, quizDetailsSchema } from "@/lib/importQuiz";
import { replaceDraft, saveDraft } from "@/lib/drafts";

/**
 * The MCP server Claude chat connects to (added in claude.ai as a custom connector with this URL).
 * Claude writes a lesson, `send_lesson` checks it and stores it as a draft, and Claude hands the user a
 * link that opens the draft in the editor as a new lesson. Nothing here touches the user's saved quizzes, so it
 * needs no login — the proxy lets this path through. Instead it asks for a shared secret (below).
 *
 * It's a Pages Router API route (not an App Router route.ts) because the quiz importer imports
 * react-dom/server (for drawing background patterns), which the App Router doesn't allow on the server.
 */
function createServer(appUrl: string) {
  const server = new McpServer({ name: "quizmatter", version: "1.0.0" });

  // Each tool also answers to its old name (from before quizzes were called lessons): Claude keeps the
  // tool list a chat started with, so older chats still call send_quiz / get_quiz_format.
  for (const name of ["get_lesson_format", "get_quiz_format"]) {
    server.registerTool(
      name,
      {
        description: "Returns the JSON format for quizMatter lesson slides, with notes and an example. Call this before send_lesson.",
        annotations: { readOnlyHint: true },
      },
      async () => ({ content: [{ type: "text", text: getClaudeFormat() }] }),
    );
  }

  for (const name of ["send_lesson", "send_quiz"]) {
    server.registerTool(
      name,
      {
        description:
          "Sends a new lesson (teaching slides and/or questions) to quizMatter and returns a link for the user. The link opens it in the editor as a new lesson, " +
          "which the user checks and saves. `slides` must follow the format from get_lesson_format. " +
          "If something is wrong, the errors come back — fix them and send again. " +
          "Otherwise it returns a layout report: where every box, text and picture landed. Check it, and if anything is off, " +
          "send the fixed lesson again with `draftId` — that replaces the draft and keeps the same link.",
        inputSchema: {
          details: quizDetailsSchema.optional().describe("About the lesson as a whole."),
          slides: z.array(z.unknown()).describe("The slides array, in the format from get_lesson_format."),
          draftId: z.uuid().optional().describe("The draft id from an earlier send_lesson, to replace that draft with this fixed version."),
        },
      },
      async ({ details = {}, slides, draftId }) => {
        // Built here to catch mistakes while Claude can still fix them, and for the layout report. The editor builds
        // the slides again from the same recipe (same positions), and also draws the background patterns, which can't
        // be drawn on Cloudflare.
        const result = buildSlides({ slides }, { drawPatterns: false });
        if ("errors" in result) {
          const text = `The lesson has mistakes. Fix them and send again:\n\n${result.errors.join("\n")}`;
          return { isError: true, content: [{ type: "text", text }] };
        }
        const draft = { details, slides };
        // A fixed version replaces its draft; if that draft is gone (expired), it's saved as a new one.
        const replaced = draftId !== undefined && (await replaceDraft(draftId, draft));
        const id = replaced ? draftId : await saveDraft(draft);
        const link = `${appUrl}/quiz/new?draft=${id}`;
        const text = [
          `${replaced ? "Replaced the draft with" : "Sent"} ${slides.length} slides. Give the user this link: ${link}`,
          `It opens "${details.title || "Untitled lesson"}" as a new lesson in the editor; nothing is saved until they click Save. The link works for 24 hours.`,
          `Draft id: ${id}`,
          "",
          "Layout report: what the editor will show. Sizes are px; x,y is the top-left corner inside its box",
          '(on lesson slides, on the 1280×720 slide). Lines starting with "!" are things to check.',
          'If anything isn\'t how you meant it, fix the lesson (e.g. with "position", sizes or shorter text) and call send_lesson again with this draftId.',
          "",
          result.report,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      },
    );
  }

  return server;
}

// Stateless: every request gets a fresh server and transport, so nothing has to be kept between requests.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only the user's own Claude connector knows this secret. It's added there as a request header,
  // either "Authorization: Bearer <secret>" or "X-API-Key: <secret>" (claude.ai only allows
  // standard header names). No secret set on the server means nobody gets in.
  const secret = process.env.MCP_SECRET;
  const sent = req.headers.authorization?.replace(/^Bearer /i, "") ?? req.headers["x-api-key"];
  if (!secret || sent !== secret) {
    res.status(401).json({ error: "Missing or wrong secret (Authorization: Bearer … or X-API-Key header)." });
    return;
  }

  const host = req.headers.host!;
  const appUrl = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createServer(appUrl).connect(transport);

  // The SDK's Node adapter reads req.rawHeaders, which is empty on Cloudflare (OpenNext), so the
  // request is rebuilt as a standard web Request from the headers Next already parsed.
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, String(value));
  const response = await transport.handleRequest(new Request(`${appUrl}/api/mcp`, { method: req.method, headers }), {
    parsedBody: req.body,
  });

  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.send(await response.text());
}

// A quiz with drawn backgrounds can be bigger than the 1 MB default.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };
