-- Each shared photo's file size in bytes, for the admin page (Admin → Photos shows it), so the page doesn't
-- have to ask the R2 bucket. Saved by the upload route (src/app/api/upload-image) and by Keep on the admin page
-- "Photo cleanup". (The photos shared before this were removed, so none is left without a size.)
-- Teachers' photo lists don't ask for it (SHARED_PHOTO_COLUMNS in src/lib/schema.ts leaves it out).
-- The limit is checked with zod first (sharedPhotoBytesSchema in src/lib/schema.ts).

alter table public.shared_photos
  add column bytes integer check (bytes > 0 and bytes <= 2097152);
