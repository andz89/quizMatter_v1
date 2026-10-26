import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseShown } from "../../homeSearch";
import { CARD_COLUMNS, loadCardContext, myId, type CardPresentation } from "../cards";
import { SavableCards } from "../CardGrid";
import { ShowMore } from "../ShowMore";

/** "Liked": the presentations I liked (see the presentation_likes migration), newest liked first, 20 at a time ("Show more" adds 20). */
export default async function LikedPage({ searchParams }: PageProps<"/liked">) {
  const shown = parseShown(await searchParams);
  const supabase = await createClient();
  const me = await myId(supabase);

  // Read from my like rows (the database only gives back my own), so the database sorts by when I liked and pages.
  // "!inner" drops a like whose presentation is unpublished, hidden or mine (it isn't in the count either).
  const { data, count, error } = await supabase
    .from("presentation_likes")
    .select(`liked_at, presentation:presentations!inner(${CARD_COLUMNS})`, { count: "exact" })
    .eq("presentation.is_published", true)
    .is("presentation.hidden_at", null)
    .neq("presentation.owner_id", me)
    .order("liked_at", { ascending: false })
    .order("presentation_id")
    .order("position", { referencedTable: "presentation.first_slide" })
    .limit(1, { referencedTable: "presentation.first_slide" })
    .range(0, shown - 1);
  if (error) throw error;

  const liked = (data as unknown as { presentation: CardPresentation }[]).map((row) => row.presentation);
  const { toSavableCard } = await loadCardContext(supabase, liked, me);

  return (
    <>
      {/* Keyed by how many show, so the cards "Show more" adds get their bookmarks from the fresh data. */}
      <SavableCards key={shown} cards={liked.map(toSavableCard)} empty="You haven't liked any presentations yet." />
      {/* Reads the address, so it waits for it in the browser. */}
      <Suspense>
        <ShowMore shown={shown} total={count ?? 0} />
      </Suspense>
    </>
  );
}
