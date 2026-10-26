import { createClient } from "@/lib/supabase/server";
import { CARD_COLUMNS, loadCardContext, myId, orderBy, type LikedPresentation } from "../cards";
import { SavableCards } from "../CardGrid";

/** "Liked": every presentation I liked (see the presentation_likes migration), newest liked first. */
export default async function LikedPage() {
  const supabase = await createClient();
  const me = await myId(supabase);

  // The ones I liked (from QuizMatter or other teachers): "!inner" keeps only presentations with a like row, and
  // the database only gives back my own likes. Unpublished or hidden ones drop off.
  const rows = await orderBy(
    supabase
      .from("presentations")
      .select(`${CARD_COLUMNS}, liked:presentation_likes!inner(liked_at)`)
      .eq("is_published", true)
      .is("hidden_at", null)
      .neq("owner_id", me),
    "updated"
  );
  if (rows.error) throw rows.error;

  // The database can't sort presentations by when I liked them (each has a list of like rows), so it's done here.
  const likedTime = (p: LikedPresentation) => Date.parse(p.liked?.[0]?.liked_at ?? "");
  const liked = [...rows.data].sort((a, b) => likedTime(b) - likedTime(a));
  const { toSavableCard } = await loadCardContext(supabase, liked, me);

  return <SavableCards cards={liked.map(toSavableCard)} empty="You haven't liked any presentations yet." />;
}
