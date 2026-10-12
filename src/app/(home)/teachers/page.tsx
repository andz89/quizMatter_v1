import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseShown } from "../../homeSearch";
import { CARD_COLUMNS, loadCardContext, myId, orderBy } from "../cards";
import { SavableCards } from "../CardGrid";
import { ShowMore } from "../ShowMore";

/** "Other teachers": their published presentations, last changed first, 20 at a time ("Show more" adds 20). */
export default async function TeachersPage({ searchParams }: PageProps<"/teachers">) {
  const shown = parseShown(await searchParams);
  const supabase = await createClient();
  const me = await myId(supabase);

  const { data, count, error } = await orderBy(
    supabase
      .from("presentations")
      .select(CARD_COLUMNS, { count: "exact" })
      .eq("is_published", true)
      .is("hidden_at", null)
      .eq("from_admin", false)
      .neq("owner_id", me),
    "updated"
  ).range(0, shown - 1);
  if (error) throw error;

  const { toSavableCard } = await loadCardContext(supabase, data, me);

  return (
    <>
      {/* Keyed by how many show, so the cards "Show more" adds get their bookmarks from the fresh data. */}
      <SavableCards key={shown} cards={data.map(toSavableCard)} empty="No other teacher has published a presentation yet." />
      {/* Reads the address, so it waits for it in the browser. */}
      <Suspense>
        <ShowMore shown={shown} total={count ?? 0} />
      </Suspense>
    </>
  );
}
