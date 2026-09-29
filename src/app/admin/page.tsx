import { SHARED_PHOTO_COLUMNS, toSharedPhoto } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { AdminPhotos } from "./AdminPhotos";

/** Admin → Photos: the photos shared with every teacher, and their categories. (layout.tsx checks the user is an admin.) */
export default async function AdminPhotosPage() {
  const supabase = await createClient();
  const [photos, categories] = await Promise.all([
    supabase.from("shared_photos").select(SHARED_PHOTO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("photo_categories").select("id, name").order("name"),
  ]);
  if (photos.error) throw photos.error;
  if (categories.error) throw categories.error;

  return (
    <AdminPhotos
      initialPhotos={photos.data.map(toSharedPhoto)}
      initialCategories={categories.data}
    />
  );
}
