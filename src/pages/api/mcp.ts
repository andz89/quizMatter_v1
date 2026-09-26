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
          "Sends a lesson (teaching slides and/or questions) to quizMatter. `slides` must follow the format from get_lesson_format. " +
          "If something is wrong, the errors come back — fix them and send again. Otherwise it returns a layout report: " +
          "where every box, text and picture landed. " +
          'Send it first with final: false to check: the user sees it as "Checking…" and can\'t open it yet, and you get the report and a draftId. ' +
          "Fix anything that's off (you can check again), then send the final version with final: true and that draftId. " +
          "The final send returns the link for the user, which opens the lesson in the editor; nothing is saved until they click Save.",
        inputSchema: {
          details: quizDetailsSchema.optional().describe("About the lesson as a whole."),
          slides: z.array(z.unknown()).describe("The slides array, in the format from get_lesson_format."),
          // Chats that started before checking existed don't send it, so they still get a finished lesson.
          final: z
            .boolean()
            .default(true)
            .describe("false = a version to check (no link for the user yet); true = the finished lesson, with a link for the user."),
          draftId: z.uuid().optional().describe("The draftId from your earlier send of this lesson. Your new version replaces that draft."),
        },
      },
      async ({ details = {}, slides, final, draftId }) => {
        // Built here to catch mistakes while Claude can still fix them, and for the layout report. The editor builds
        // the slides again from the same recipe (same positions), and also draws the background patterns, which can't
        // be drawn on Cloudflare.
        const result = buildSlides({ slides }, { drawPatterns: false });
        if ("errors" in result) {
          const text = `The lesson has mistakes. Fix them and send again:\n\n${result.errors.join("\n")}`;
          return { isError: true, content: [{ type: "text", text }] };
        }
        // A checking version is marked, so the lesson lists show it as "Checking…" and don't open it.
        const draft = final ? { details, slides } : { details, slides, checking: true };
        // A new version replaces its earlier draft (a checking one turns into the final one); if that draft
        // is gone (expired), it's saved as a new one.
        const replaced = draftId !== undefined && (await replaceDraft(draftId, draft));
        const id = replaced ? draftId : await saveDraft(draft);
        const title = details.title || "Untitled lesson";
        const intro = final
          ? [
              `Sent the final version of "${title}" (${slides.length} slides). Give the user this link: ${appUrl}/quiz/new?draft=${id}`,
              "It opens the lesson in the editor; nothing is saved until they click Save. The link works for 24 hours.",
            ]
          : [
              `Sent "${title}" (${slides.length} slides) for checking. The user sees it as "Checking…" and can't open it yet; there's no link for them.`,
              'Check the report below. Fix anything that isn\'t how you meant it (e.g. with "position", sizes or shorter text), then call send_lesson',
              `with final: true and draftId "${id}". If you don't within 10 minutes, the user sees it as "Not finished" and can open this version.`,
            ];
        const text = [
          ...intro,
          `Draft id: ${id}`,
          "",
          "Layout report: what the editor will show. Sizes are px; x,y is the top-left corner inside its box",
          '(on lesson slides, on the 1280×720 slide). Lines starting with "!" are things to check.',
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
