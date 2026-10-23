import { notFound, redirect } from "next/navigation";
import { getAccount } from "@/lib/account";
import { SHARED_PHOTO_COLUMNS, toSharedPhoto } from "@/lib/schema";
import { contains, withinSince } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import { AdminPhotos, type PhotoCounts } from "./AdminPhotos";
import { PHOTOS_PER_PAGE, parsePhotoSearch, photoSearchHref, type PhotoSearch } from "./photoSearch";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Admin → Photos: the photos shared with every teacher, and their categories. The search in the page link picks
 * which ones, and only one page of them is loaded. A plain admin sees only the photos they uploaded; the super
 * admin sees them all. (layout.tsx checks the user is an admin.)
 */
export default async function AdminPhotosPage({ searchParams }: PageProps<"/admin/photos">) {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  const account = await getAccount();
  if (!account.isAdmin) notFound();
  // A plain admin sees only the shared photos they uploaded; the super admin sees them all.
  const ownerId = account.isSuperAdmin ? null : account.id;
  const search = parsePhotoSearch(await searchParams);
  const supabase = await createClient();
  const first = (search.page - 1) * PHOTOS_PER_PAGE;

  const [photos, perCategory, categories] = await Promise.all([
    findPhotos(supabase, search, ownerId).range(first, first + PHOTOS_PER_PAGE - 1),
    // For the filter buttons: how many photos each category has, and how many miss a description or source.
    (() => {
      const query = supabase.from("shared_photo_counts").select("category_id, photos, no_description, no_source, waiting");
      return ownerId ? query.eq("uploaded_by", ownerId) : query;
    })(),
    supabase.from("photo_categories").select("id, name").order("name"),
  ]);
  // A page past the end (e.g. its last photo was just removed) goes to the last page instead.
  if (photos.error?.code === "PGRST103" || (photos.data?.length === 0 && search.page > 1)) {
    const { count } = await findPhotos(supabase, search, ownerId, true);
    redirect(photoSearchHref({ ...search, page: Math.max(1, Math.ceil((count ?? 0) / PHOTOS_PER_PAGE)) }));
  }
  if (photos.error) throw photos.error;
  if (perCategory.error) throw perCategory.error;
  if (categories.error) throw categories.error;

  const fileSizes: Record<string, number> = {};
  for (const { src, bytes } of photos.data) if (bytes) fileSizes[src] = bytes;
  // Editors' photos no teacher can see yet (see the editor_photos migration).
  const waitingSrcs = photos.data.filter((row) => !row.is_public).map((row) => row.src);

  const counts: PhotoCounts = { total: 0, byCategory: {}, noDescription: 0, noSource: 0, waiting: 0 };
  for (const row of perCategory.data) {
    // One row per category and uploader, so they're added up.
    counts.byCategory[row.category_id] = (counts.byCategory[row.category_id] ?? 0) + row.photos;
    counts.total += row.photos;
    counts.noDescription += row.no_description;
    counts.noSource += row.no_source;
    counts.waiting += row.waiting;
  }

  return (
    <AdminPhotos
      photos={photos.data.map(toSharedPhoto)}
      fileSizes={fileSizes}
      waitingSrcs={waitingSrcs}
      categories={categories.data}
      counts={counts}
      matchCount={photos.count ?? 0}
      search={search}
      isSuperAdmin={account.isSuperAdmin}
    />
  );
}

/** The shared photos this search finds, in its order, with how many there are in all (or only that, with `countOnly`). */
function findPhotos(supabase: Supabase, search: PhotoSearch, ownerId: string | null, countOnly = false) {
  // With each photo's file size, which only this page needs (see SHARED_PHOTO_COLUMNS).
  let query = supabase.from("shared_photos_search").select(`${SHARED_PHOTO_COLUMNS}, bytes, is_public`, { count: "exact", head: countOnly });
  if (ownerId) query = query.eq("uploaded_by", ownerId);
  // Every word must be somewhere, like the old search on this page.
  for (const word of search.q.split(/\s+/).filter(Boolean)) {
    const pattern = contains(word);
    query = query.or(
      `file_name.ilike.${pattern},description.ilike.${pattern},tags_text.ilike.${pattern},source.ilike.${pattern},category_name.ilike.${pattern}`
    );
  }
  if (search.name) query = query.ilike("file_name", contains(search.name));
  if (search.description) query = query.ilike("description", contains(search.description));
  if (search.tags) query = query.ilike("tags_text", contains(search.tags));
  if (search.source) query = query.ilike("source", contains(search.source));
  if (search.not) {
    const pattern = contains(search.not);
    for (const column of ["file_name", "description", "tags_text", "source"]) query = query.not(column, "ilike", pattern);
  }
  if (search.category) query = query.eq("category_id", search.category);
  if (search.missing === "description") query = query.eq("description", "");
  if (search.missing === "source") query = query.eq("source", "");
  if (search.missing === "waiting") query = query.eq("is_public", false);
  const since = withinSince(search.within);
  if (since) query = query.gte("created_at", new Date(since).toISOString());

  if (search.sort === "name") query = query.order("file_name");
  else if (search.sort === "biggest") query = query.order("bytes", { ascending: false, nullsFirst: false });
  else query = query.order("created_at", { ascending: search.sort === "oldest" });
  // Photos with the same name, size or time keep one order, so no photo shows on two pages.
  return query.order("src");
}
