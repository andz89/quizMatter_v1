import { createClient } from "@/lib/supabase/server";
import { CARD_COLUMNS, loadCardContext, myId, orderBy } from "../cards";
import { QuizMatterPresentations } from "./QuizMatterPresentations";

/** "From QuizMatter": what admins shared with every teacher (from Admin → Presentations), last changed first. */
export default async function QuizMatterPage() {
  const supabase = await createClient();
  const me = await myId(supabase);

  // Hidden ones are already left out by the database, except for admins (who can see them on Admin → Reports).
  // An admin sees their own here too, just like teachers do.
  const rows = await orderBy(
    supabase.from("presentations").select(CARD_COLUMNS).eq("is_published", true).is("hidden_at", null).eq("from_admin", true),
    "updated"
  );
  if (rows.error) throw rows.error;

  const { toSavableCard } = await loadCardContext(supabase, rows.data, me);
  const cards = rows.data.map((p) => ({
    ...toSavableCard(p),
    createdAt: Date.parse(p.created_at),
    updatedAt: Date.parse(p.updated_at),
  }));

  return <QuizMatterPresentations cards={cards} />;
}
