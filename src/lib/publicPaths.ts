// The public preview's addresses that a logged-out visitor (or a robot: Google, Facebook's link reader) may open
// (docs/superpowers/specs/2026-11-20-public-presentation-preview-design.md). src/proxy.ts lets them through; the
// presentation page itself then shows the preview, or sends the visitor to login when it isn't published.
// Next may add an ending to a picture's address (opengraph-image-<hash>), never a "/".
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const PUBLIC_PREVIEW_PATH = new RegExp(`^(/presentation/${UUID}(/opengraph-image[^/]*)?|/opengraph-image[^/]*|/robots\\.txt)$`);

/** A presentation's page (`/presentation/<uuid>`) or its picture, the site picture, or robots.txt. */
export function isPublicPreviewPath(path: string): boolean {
  return PUBLIC_PREVIEW_PATH.test(path);
}
