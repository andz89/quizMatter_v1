import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { buildSlides, getClaudeFormat, claudeDetailsSchema } from "@/lib/importPresentation";
import { replaceDraft, saveDraft } from "@/lib/drafts";
import type { Photo, Slide } from "@/lib/schema";

/**
 * The MCP server Claude chat connects to (added in claude.ai as a custom connector with this URL).
 * Claude writes a presentation, `send_presentation` checks it and stores it as a draft, and Claude hands the user a
 * link that opens the draft in the editor as a new presentation. Nothing here touches the user's saved presentations.
 *
 * Login: the proxy lets this path through, because Claude has no browser cookies. Instead Claude logs in with OAuth
 * (the standard "let this app act for me" login): Supabase is the OAuth server, the user logs in to QuizMatter and
 * clicks Allow on /oauth/consent, and Claude then sends that user's login token with every request. Without a valid
 * token the answer is 401, which points Claude to /.well-known/oauth-protected-resource to start the login.
 * For now only admins can use it.
 *
 * It's a Pages Router API route (not an App Router route.ts) because the presentation importer imports
 * react-dom/server (for drawing background patterns), which the App Router doesn't allow on the server.
 */
function createServer(appUrl: string, userId: string) {
  const server = new McpServer({ name: "quizmatter", version: "1.0.0" });

  // Each tool also answers to its old names (from when presentations were called quizzes, then lessons): Claude keeps the
  // tool list a chat started with, so older chats still call send_lesson / send_quiz and their get_…_format.
  for (const name of ["get_presentation_format", "get_lesson_format", "get_quiz_format"]) {
    server.registerTool(
      name,
      {
        description:
          "Returns the JSON format for quizMatter slides (blank, title, question, and video / slide deck / picture slides), with notes and an example. Call this before send_presentation. " +
          "If the user gives you a reference (a module, book lesson, worksheet, file or link), first ask whether to use all its short quizzes and activities as question slides, or only the final assessment.",
        annotations: { readOnlyHint: true },
      },
      async () => ({ content: [{ type: "text", text: getClaudeFormat() }] }),
    );
  }

  server.registerTool(
    "find_photos",
    {
      description:
        "Searches quizMatter's shared photo library (real photos the admins uploaded, each with a file name, description and tags). " +
        'Give a few words about what the photo should show, e.g. "frog rainforest". Returns up to 20 photos (best matches first) ' +
        'with their file name, description, tags, category and source (who owns it or where it came from, to credit it), plus every category name. To put one on a slide, use { "asset": "photo", "photo": { src, width, height } } in "elements".',
      inputSchema: { query: z.string().max(200).describe("Words about what the photo should show. Empty = the newest photos.") },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const supabase = createAdminClient();
      if (!supabase) return { isError: true, content: [{ type: "text", text: "The photo library isn't available right now." }] };
      const [photos, categories] = await Promise.all([
        supabase.rpc("search_shared_photos", { query }),
        supabase.from("photo_categories").select("name").order("name"),
      ]);
      if (photos.error || categories.error) {
        return { isError: true, content: [{ type: "text", text: "Couldn't search the photo library. Try again." }] };
      }
      const text = JSON.stringify({ photos: photos.data, categories: categories.data.map((c) => c.name) }, null, 2);
      return { content: [{ type: "text", text }] };
    },
  );

  for (const name of ["send_presentation", "send_lesson", "send_quiz"]) {
    server.registerTool(
      name,
      {
        description:
          "Sends a presentation to quizMatter, an open canvas presentation tool (like Canva or PowerPoint): blank and title slides for any presentation, video / slide deck / picture slides from a link, " +
          "and/or question slides for a quiz or assessment. `slides` must follow the format from get_presentation_format. " +
          "If something is wrong, the errors come back — fix them and send again. Otherwise it returns a layout report: " +
          "where every box, text and picture landed. " +
          'Send it first with final: false to check: the user sees it as "Checking…" and can\'t open it yet, and you get the report and a draftId. ' +
          "Fix anything that's off (you can check again), then send the final version with final: true and that draftId. " +
          "The final send returns the link for the user, which opens the presentation in the editor; nothing is saved until they click Save.",
        inputSchema: {
          details: claudeDetailsSchema.optional().describe("About the presentation as a whole."),
          slides: z.array(z.unknown()).describe("The slides array, in the format from get_presentation_format."),
          // Chats that started before checking existed don't send it, so they still get a finished presentation.
          final: z
            .boolean()
            .default(true)
            .describe("false = a version to check (no link for the user yet); true = the finished presentation, with a link for the user."),
          draftId: z.uuid().optional().describe(
              "The draftId from your earlier send of this presentation. Your new version replaces that draft. " +
                "Once the user has saved it, it can't be replaced: the send makes a new presentation with a new link.",
            ),
        },
      },
      async ({ details = {}, slides, final, draftId }) => {
        // Built here to catch mistakes while Claude can still fix them, and for the layout report. The editor builds
        // the slides again from the same recipe (same positions), and also draws the background patterns, which can't
        // be drawn on Cloudflare.
        const result = buildSlides({ slides }, { drawPatterns: false });
        // Photos are checked against the library only once the slides themselves are right.
        const errors = "errors" in result ? result.errors : await checkPhotos(result.slides);
        if ("errors" in result || errors.length) {
          const text = `The presentation has mistakes. Fix them and send again:\n\n${errors.join("\n")}`;
          return { isError: true, content: [{ type: "text", text }] };
        }
        // A checking version is marked, so the presentation lists show it as "Checking…" and don't open it.
        const draft = final ? { details, slides } : { details, slides, checking: true };
        // A new version replaces its earlier draft (a checking one turns into the final one); if that draft
        // is gone (expired), it's saved as a new one.
        const replaced = draftId !== undefined && (await replaceDraft(draftId, draft, userId));
        const id = replaced ? draftId : await saveDraft(draft, userId);
        const title = details.title || "Untitled presentation";
        // The old draft is gone once the user saved it (or after a day), so this send became a new one.
        const newDraftNote =
          draftId !== undefined && !replaced
            ? [
                `Draft ${draftId} is gone: the user already saved it (or it expired), so this was sent as a NEW presentation with a NEW link and draftId.`,
                "Their saved copy was not changed. Use the new link and draftId from now on.",
              ]
            : [];
        const intro = final
          ? [
              `Sent the final version of "${title}" (${slides.length} slides). Give the user this link: ${appUrl}/presentation/new?draft=${id}`,
              "It opens the presentation in the editor; nothing is saved until they click Save. The link works for 24 hours.",
            ]
          : [
              `Sent "${title}" (${slides.length} slides) for checking. The user sees it as "Checking…" and can't open it yet; there's no link for them.`,
              'Check the report below. Fix anything that isn\'t how you meant it (e.g. with "position", sizes or shorter text), then call send_presentation',
              `with final: true and draftId "${id}". If you don't within 10 minutes, the user sees it as "Not finished" and can open this version.`,
            ];
        const text = [
          ...newDraftNote,
          ...intro,
          `Draft id: ${id}`,
          "",
          "Layout report: what the editor will show. Sizes are px; x,y is the top-left corner inside its box",
          '(on blank slides, on the 1280×720 slide). Lines starting with "!" are things to check.',
          "",
          result.report,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      },
    );
  }

  return server;
}

/**
 * Supabase with the secret key, for the shared photo library: this route has no logged-in user. The key only
 * lives on the server (a Cloudflare secret, also used by the photo cleanup). null if it isn't set.
 */
function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  return key ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } }) : null;
}

/**
 * Checks Claude's login token (the one Supabase gave it after the user clicked Allow). The user's id and whether
 * they're an admin, or null if the token is missing, wrong or expired.
 */
async function checkLogin(token: string): Promise<{ id: string; isAdmin: boolean } | null> {
  // Acts as that user, so is_admin() answers for them.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data } = await supabase.auth.getClaims(token);
  if (!data) return null;
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return { id: data.claims.sub, isAdmin: isAdmin === true };
}

/** Every photo on the slides must be a shared photo, with its real size (as find_photos gave it). The problems, if any. */
async function checkPhotos(slides: Slide[]): Promise<string[]> {
  // Photos sit in their element's "image", wherever the element is (a box, the answer canvas…).
  const used: Photo[] = [];
  JSON.parse(JSON.stringify(slides), (key, value) => {
    if (key === "image") used.push(value);
    return value;
  });
  if (used.length === 0) return [];

  const supabase = createAdminClient();
  if (!supabase) return ["Photos can't be checked right now, so leave them out."];
  const { data, error } = await supabase
    .from("shared_photos")
    .select("src, width, height")
    .in("src", [...new Set(used.map((photo) => photo.src))]);
  if (error) return ["Couldn't check the photos. Send again, or leave them out."];

  const known = new Map(data.map((photo) => [photo.src, photo]));
  const problems = used.map((photo) => {
    const real = known.get(photo.src);
    if (!real) return `${photo.src} isn't a shared photo. Only use photos from find_photos.`;
    if (real.width !== photo.width || real.height !== photo.height) {
      return `${photo.src} is ${real.width}×${real.height}, not ${photo.width}×${photo.height}. Copy "photo" exactly as find_photos gave it.`;
    }
    return "";
  });
  return [...new Set(problems.filter(Boolean))];
}

// Stateless: every request gets a fresh server and transport, so nothing has to be kept between requests.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const host = req.headers.host!;
  const appUrl = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  const user = token ? await checkLogin(token) : null;
  if (!user) {
    // The standard answer that makes Claude start the login (it reads where to log in from this link).
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource"`);
    res.status(401).json({ error: "Please log in to QuizMatter." });
    return;
  }
  if (!user.isAdmin) {
    res.status(403).json({ error: "Only QuizMatter admins can use Claude for now." });
    return;
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createServer(appUrl, user.id).connect(transport);

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

// A presentation with drawn backgrounds can be bigger than the 1 MB default.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };
