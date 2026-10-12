import { createClient } from "@/lib/supabase/server";
import { CARD_COLUMNS, loadCardContext, myId, orderBy, type SavedPresentation } from "../cards";
import { SavableCards } from "../CardGrid";

/** "Saved": every presentation I saved (MAX_SAVED at most), newest saved first. */
export default async function SavedPage() {
  const supabase = await createClient();
  const me = await myId(supabase);

  // The ones I saved (from QuizMatter or other teachers): "!inner" keeps only presentations with a saved row, and
  // the database only gives back my own saved rows. Unpublished or hidden ones drop off.
  const rows = await orderBy(
    supabase
      .from("presentations")
      .select(`${CARD_COLUMNS}, saved:saved_presentations!inner(saved_at)`)
      .eq("is_published", true)
      .is("hidden_at", null)
      .neq("owner_id", me),
    "updated"
  );
  if (rows.error) throw rows.error;

  // The database can't sort presentations by when I saved them (each has a list of saved rows), so it's done here.
  const savedTime = (p: SavedPresentation) => Date.parse(p.saved?.[0]?.saved_at ?? "");
  const saved = [...rows.data].sort((a, b) => savedTime(b) - savedTime(a));
  const { toSavableCard } = await loadCardContext(supabase, saved, me);

  return <SavableCards cards={saved.map(toSavableCard)} empty="You haven't saved any presentations yet." removeOnUnsave />;
}
