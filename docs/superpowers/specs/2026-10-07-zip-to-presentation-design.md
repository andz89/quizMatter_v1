# Zip → Presentation (Claude builds a presentation from a zip of photos and text)

## Goal

An admin attaches a zip in a claude.ai chat (photos plus lesson text, e.g. a .docx, .txt or .md) and asks Claude
to make it into a QuizMatter presentation. Claude reads the text, plans the slides, uploads the photos to the
shared photo library, and puts each photo on the slide where it fits best — all in one chat.

- **Who:** admins only (`prepare_photo_upload` is already admin-only).
- **Photos:** saved in the shared library and **approved right away**, so they can go on the slides at once and
  every teacher can find them later.
- **Text:** free text. Claude decides the slides and which photo goes on which slide, by looking at the photos.

## What already works (no change)

- Claude's code sandbox can unzip the file, read the text and open the photos. QuizMatter needs no zip code.
- `prepare_photo_upload` → one-time link per photo → `POST /api/claude-photo?ticket=…` saves the WebP and answers
  with `src`, `width`, `height`.
- `send_presentation` takes `{ "asset": "photo", "photo": { src, width, height } }` in `elements`.

## The one thing in the way

`checkPhotos` (`src/pages/api/mcp.ts`) refuses photos that aren't approved, and every photo Claude uploads is saved
with `approved: false`. So today a photo from the zip can't go on a slide until an admin approves it by hand.

## Design

### 1. `prepare_photo_upload` gets an "approve now" choice

New optional input, next to `photos`:

```ts
for_presentation: z.boolean().optional().describe(
  "true when these photos are for a presentation you're about to send (e.g. from a zip the user attached): " +
  "they're approved right away, so they can go on the slides. Leave it out for photos only meant for the library."
)
```

- Left out / `false` → nothing changes: the photos wait for review, as today.
- `true` → the photos are saved with `approved: true`.

The answer text changes with it:
- `true`: the end says the photos are approved and to put each one on the slides with the `src`, `width` and
  `height` the upload answer gave, exactly as given.
- not `true`: same text as today ("They wait for review…").

### 2. The ticket remembers the choice

The choice must reach `/api/claude-photo`, which only gets the ticket id. It goes in the ticket's stored JSON,
so **no D1 table change**:

- `createPhotoTickets(ownerId, photos, approved)` stores `JSON.stringify({ ...photo, approved })`.
- `getPhotoTicket` returns `{ ownerId, details, approved }`, with `approved = parsed.approved === true` (an old
  ticket without it → `false`).
- `PhotoTicket` type gets `approved: boolean`.
- `claudePhotoSchema.safeParse(ticket.details)` in the route still works: zod drops the extra `approved` key.

### 3. `/api/claude-photo` uses it

- The insert uses `approved: ticket.approved` instead of `approved: false`.
- The success answer: if approved, "Added … It's approved, so it can go on slides now." (plus `src`, `width`,
  `height`, as today); otherwise today's text.
- **Photo already in the library** (same file): today it answers only `{ src }`. It now also answers `width` and
  `height` (selected with `file_name`), so Claude can put it on a slide. If the ticket is approved and the existing
  photo is still waiting for review, it's approved too (an admin sent it for a presentation); the answer says so.
  It's still not changed in any other way.
- Nothing new is saved from Claude's input, so zod use stays as it is (`claudePhotoSchema`, `sharedPhotoSchema`,
  `sharedPhotoBytesSchema` before the insert; `approved` is a boolean the server set itself).

### 4. Instructions for Claude

- **`prepare_photo_upload` description:** add one sentence: "If the user attached a zip, unzip it in your code
  sandbox first; the photos inside are the attached photos."
- **Its step text:** step 0: "If the photos are in a zip, unzip it (e.g. `unzip -o file.zip -d /tmp/zip`) and use
  the photos from there." Keep the rest.
- **Format notes, "Real photos" (`src/lib/importPresentation.ts`):** the rule "Only use photos find_photos gave
  you" becomes "Only use photos find_photos gave you, or that you uploaded with prepare_photo_upload and
  for_presentation: true (copy `src`, `width`, `height` from its upload answer)". Add a short bullet for the zip
  case: read the text, plan the slides from it, upload the zip's photos with `for_presentation: true`, then put
  each photo on the slide it fits best; don't leave a zip photo out unless it fits nowhere, and say which ones
  were left out.
- **`checkPhotos` error message:** "isn't a shared photo. Only use photos from find_photos or ones you just
  uploaded with for_presentation: true."
- The source rule stays: every photo needs a source; Claude asks the admin if the zip doesn't say. Credits on the
  slide and on the References slide work as today.

## Files touched

| File | Change |
|---|---|
| `src/pages/api/mcp.ts` | `for_presentation` input, pass it to `createPhotoTickets`, answer text, `checkPhotos` message |
| `src/lib/photoTickets.ts` | store / read `approved` in the ticket JSON |
| `src/app/api/claude-photo/route.ts` | insert with `ticket.approved`; answers; existing-photo case |
| `src/lib/importPresentation.ts` | "Real photos" notes for zip photos |

No new package, no Supabase migration, no D1 migration, no app UI change.

## Not doing (YAGNI)

- No server-side zip reading or a new "send zip" tool (the MCP server can't read chat attachments anyway).
- No change to the 20-photos-per-call limit: a bigger zip means two calls.
- No change for teachers: the tool stays admin-only.

## Errors

- Upload fails → the route's answer says why (as today); Claude fixes and sends again with the same link.
- Claude puts a not-approved or unknown photo on a slide → `checkPhotos` refuses it with the new message.
- Ticket expired (1 hour) → same as today: call `prepare_photo_upload` again.

## Testing

`npx tsc --noEmit` and `npm run lint`. Live test by the user: reconnect the claude.ai connector, start a new chat,
attach a zip and ask Claude to build the presentation (new tool inputs only show up in a new chat).
