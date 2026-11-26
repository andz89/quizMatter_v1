# Open photo uploads to every teacher

Date: 2026-11-26. Status: approved in chat (small change).

## Why

Uploading your own photos was for editors and admins only ("This will be available soon." for everyone else),
waiting for a storage limit. The limit now exists (`docs/superpowers/specs/2026-11-26-photo-storage-limit-design.md`:
50 MB per teacher, 500 MB per editor), so every teacher can upload.

## Approaches

1. **Chosen: drop the editor/admin gate everywhere.** Any logged-in, not banned teacher uploads; the storage limit,
   the click limits (30 a minute, 300 a day) and the ban check stay. `checkCanUpload` and the "available soon"
   message go away.
2. Keep `checkCanUpload` but return true for everyone: a request and a function that decide nothing. Rejected.

## What changes

- `src/app/api/upload-image/route.ts`: no `is_editor` / `is_admin` check for an own photo; `is_banned` stays (403).
- `src/lib/photos.tsx`: `checkCanUpload` removed.
- `src/components/editor/PhotosPanel.tsx`: no `canUpload` state or "available soon" message; Upload is greyed out
  only while paused or full; the storage bar shows for everyone with a limit (not admins).
- `src/lib/useElementDropTarget.ts`: a file dropped on a slide always uploads (one at a time).
- Privacy Policy "Your work": the photos you upload are every teacher's work, not only an editor's.
- Notes: `src/app/api/CLAUDE.md`, `src/components/editor/CLAUDE.md`, `src/lib/CLAUDE.md`, `e2e/CLAUDE.md`.

Unchanged: only editors' uploads go to the waiting "From editors" shared photos; a teacher's upload stays in their
own "My photos" and slides. Profile photos stay editors-only.

## Test

`e2e/photo-uploads.mjs`: a plain teacher's upload works and its answer carries `storage` with the 50 MB limit;
the Photos panel shows the bar and an enabled Upload, with no "available soon".
