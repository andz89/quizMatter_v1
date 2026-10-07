# Zip → Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin attach a zip (photos + lesson text) in claude.ai and have Claude build a QuizMatter presentation with those photos on the slides, in one chat.

**Architecture:** `prepare_photo_upload` gets an optional `for_presentation` flag. The flag rides inside the upload ticket's JSON (no table change) to `/api/claude-photo`, which saves the photo as approved, so `send_presentation`'s `checkPhotos` accepts it right away. Claude's instructions (tool texts + format notes) tell it to unzip, upload with the flag, and use the `src`/`width`/`height` the upload answer gives.

**Tech Stack:** Next.js 16 (Pages API route for MCP, App Router route for the upload), `@modelcontextprotocol/sdk`, zod 4, Cloudflare D1 (tickets), Supabase (`shared_photos`). No new packages.

**Spec:** `docs/superpowers/specs/2026-10-07-zip-to-presentation-design.md`

## Global Constraints

- Admins only: `prepare_photo_upload` stays behind the existing admin check in `src/pages/api/mcp.ts`.
- `for_presentation` left out or `false` → exactly today's behavior and answer text (photos wait for review).
- No D1 migration, no Supabase migration, no new package, no app UI change.
- Zod before saving stays as today: `claudePhotoSchema`, `sharedPhotoSchema`, `sharedPhotoBytesSchema` before the insert. `approved` is a boolean the server sets itself, never typed by Claude into the row.
- Answers from `/api/claude-photo` are plain sentences (Claude reads them) and keep the `{ ok, message, ...extra }` shape from `answer()`.
- **Do not commit.** The branch holds the user's uncommitted diagram work (including `src/lib/importPresentation.ts`); leave every change unstaged and tell the user at the end.
- The project has no test runner and the user does all live testing. Each task is checked with `npx tsc --noEmit` and `npm run lint`, plus reading the diff against the Review Focus list.

## Review Focus

1. A ticket made before this change (no `approved` in its JSON) → treated as not approved, no crash. Task 1, Step 1 (`approved === true`).
2. The same photo is already in the library **waiting for review** and is sent with `for_presentation: true` → it gets approved, and the answer includes `src`, `width`, `height`. Task 1, Step 2.
3. The same photo is already **approved** and is sent without the flag → nothing changes; a photo is never un-approved. Task 1, Step 2 (only `ticket.approved && !existing.approved` updates).
4. Approving an existing photo fails → the ticket is **not** used up, so Claude can send again with the same link. Task 1, Step 2 (update runs before `deletePhotoTicket`).
5. `for_presentation` left out → tool answer text and saved `approved: false` are the same as today. Task 1, Steps 2–3.

---

### Task 1: The "approve now" flag, end to end

**Files:**
- Modify: `src/lib/photoTickets.ts` (type `PhotoTicket`, `createPhotoTickets`, `getPhotoTicket`)
- Modify: `src/app/api/claude-photo/route.ts` (existing-photo case, insert, success answer)
- Modify: `src/pages/api/mcp.ts` (`prepare_photo_upload` input, handler, answer text)

**Interfaces:**
- Produces: `PhotoTicket = { ownerId: string; details: ClaudePhotoDetails; approved: boolean }`; `createPhotoTickets(ownerId: string, photos: ClaudePhotoDetails[], approved: boolean): Promise<string[]>`.

- [ ] **Step 1: Tickets carry `approved`** — in `src/lib/photoTickets.ts`:

```ts
export type PhotoTicket = { ownerId: string; details: ClaudePhotoDetails; approved: boolean };

/**
 * Stores a ticket for each photo and returns their ids, in the same order. Also clears out expired tickets.
 * `approved`: the photos are for a presentation Claude is about to send, so they skip the review.
 */
export async function createPhotoTickets(ownerId: string, photos: ClaudePhotoDetails[], approved: boolean): Promise<string[]> {
```

and in its insert: `.bind(ids[i], ownerId, JSON.stringify({ ...photo, approved }), now)`.

In `getPhotoTicket`, replace the return:

```ts
  if (!row) return null;
  // Tickets made before "approved" existed don't have it: they wait for review, as they did then.
  const { approved, ...details } = JSON.parse(row.details);
  return { ownerId: row.owner_id, details, approved: approved === true };
```

- [ ] **Step 2: The upload route uses it** — in `src/app/api/claude-photo/route.ts`, replace the "already shared" block:

```ts
  // The same photo is already shared: it's left as it is (an admin may have changed its details), except that a
  // photo still waiting for review is approved when it's for a presentation. Its size comes back so it can go on slides.
  const { data: existing, error: existingError } = await supabase
    .from("shared_photos")
    .select("file_name, width, height, approved")
    .eq("src", src)
    .maybeSingle();
  if (existingError) return answer(500, "Couldn't add the photo. Send it again.");
  if (existing) {
    const shared = { src, width: existing.width, height: existing.height };
    if (ticket.approved && !existing.approved) {
      // Approved before the ticket is used up, so a failure can be sent again with the same link.
      const { error } = await supabase.from("shared_photos").update({ approved: true }).eq("src", src);
      if (error) return answer(500, "Couldn't approve the photo. Send it again.");
      await deletePhotoTicket(ticketId.data);
      return answer(200, `This photo was already in the library, as "${existing.file_name}", waiting for review. It's approved now, so it can go on slides.`, shared);
    }
    await deletePhotoTicket(ticketId.data);
    return answer(200, `This photo is already in the library, as "${existing.file_name}". Nothing was changed.`, shared);
  }
```

In the insert, change `approved: false` to `approved: ticket.approved`.

Replace the success answer:

```ts
  const kb = Math.round(body.byteLength / 1024);
  const added = `Added "${info.file_name}" (${size.width}×${size.height} px, ${kb} KB) to "${category}"`;
  const review = ticket.approved ? "It's approved, so it can go on slides now." : "It waits for an admin's review before teachers see it.";
  return answer(200, `${added}. ${review}`, { src, width: size.width, height: size.height });
```

Update the file's top comment: "It waits for an admin's review (approved: false) before teachers see it, unless the ticket says it's for a presentation (then it's approved right away)."

- [ ] **Step 3: The tool takes the flag** — in `src/pages/api/mcp.ts`, `prepare_photo_upload`:

Description: after the first sentence add `"If the user attached a zip, unzip it in your code sandbox first; the photos inside are the attached photos. " +`, and at the end add `' Set "for_presentation": true when the photos are for a presentation you\'ll send next: they\'re approved right away, so they can go on the slides.'`.

Input schema:

```ts
      inputSchema: {
        photos: z.array(claudePhotoSchema).min(1).max(20).describe("One entry per photo, in the order you'll upload them."),
        for_presentation: z
          .boolean()
          .optional()
          .describe("true when these photos go on a presentation you'll send next (e.g. from a zip): they're approved right away. Leave it out for photos only meant for the library."),
      },
```

Handler:

```ts
    async ({ photos, for_presentation }) => {
      const approved = for_presentation === true;
      const ids = await createPhotoTickets(userId, photos, approved);
```

In the text, add as the first line: `"If the photos came in a zip, unzip it first (e.g. unzip -o file.zip -d /tmp/zip) and use the photos from there.",` and replace the last two lines ("When you're done…" / "see them until…") with:

```ts
        ...(approved
          ? [
              "When you're done, tell the user which photos were added. They're approved, so they can go on slides now: put each one in",
              '"elements" as { "asset": "photo", "photo": { "src", "width", "height" } }, copied exactly from its upload answer.',
            ]
          : [
              "When you're done, tell the user which photos were added. They wait for review: teachers (and find_photos) don't",
              'see them until an admin approves them on Admin → Photos ("Waiting for review"), where they can also edit them.',
            ]),
```

- [ ] **Step 4: Check** — run `npx tsc --noEmit` and `npm run lint`. Expected: no errors in the three files. Read the diff against Review Focus 1–5.

### Task 2: Claude's instructions for zip photos on slides

**Files:**
- Modify: `src/lib/importPresentation.ts` ("Real photos" notes, ~line 730)
- Modify: `src/pages/api/mcp.ts` (`checkPhotos` message and comment)

**Interfaces:**
- Consumes: the `for_presentation` flag name from Task 1.

- [ ] **Step 1: Format notes** — in the "Real photos" notes, replace `Only use photos find_photos gave you: any other photo is refused.` with:

```
Only use photos find_photos gave you, or ones you just uploaded with prepare_photo_upload and "for_presentation": true (copy "src", "width" and "height" from its upload answer): any other photo is refused.
```

and add a bullet right after that line:

```
- From a zip the user attached (photos plus lesson text): unzip it, read the text and plan the slides from it, upload the zip's photos with prepare_photo_upload and "for_presentation": true (ask the user for the photos' source if the zip doesn't say), then put each photo on the slide it fits best. Leave a photo out only if it fits nowhere, and tell the user which ones you left out.
```

(The notes are a template literal: keep plain quotes, no backticks.)

- [ ] **Step 2: `checkPhotos` message** — in `src/pages/api/mcp.ts`:

```ts
/** Every photo on the slides must be an approved shared photo, with its real size (as find_photos or the upload answer gave it). The problems, if any. */
```

```ts
    if (!real) return `${photo.src} isn't a shared photo. Only use photos from find_photos, or ones you just uploaded with "for_presentation": true.`;
```

and the size message: `Copy "photo" exactly as find_photos or the upload answer gave it.`

- [ ] **Step 3: Check** — run `npx tsc --noEmit` and `npm run lint`. Then `git diff` all four files next to the spec: every spec section done, nothing extra, no commit made.
