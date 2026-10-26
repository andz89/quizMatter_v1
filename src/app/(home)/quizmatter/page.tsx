import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { OTHER_CHOICE, SUBJECTS } from "@/lib/schema";
import { firstValues } from "@/lib/search";
import { NO_SUBJECT, QUIZMATTER_ROW_SIZE, parseShown } from "../../homeSearch";
import { CARD_COLUMNS, bySubjectChip, loadCardContext, myId, orderBy } from "../cards";
import { QuizMatterPresentations } from "./QuizMatterPresentations";

// The picked subject chip ("" = All, NO_SUBJECT = "See all" of the presentations with no subject) and the sort.
const quizMatterSchema = z.object({
  subject: z.union([z.enum(SUBJECTS), z.literal(OTHER_CHOICE), z.literal(NO_SUBJECT), z.literal("")]).catch(""),
  sort: z.enum(["updated", "newest"]).catch("updated"),
});

/**
 * "From QuizMatter": what admins shared with every teacher (from Admin → Presentations), last changed first (or newest).
 * Reads only what shows: per subject, its exact count and its first 5 cards (one request each). A picked subject shows
 * 20 at a time ("Show more" adds 20), like Other teachers.
 */
export default async function QuizMatterPage({ searchParams }: PageProps<"/quizmatter">) {
  const params = await searchParams;
  const { subject, sort } = quizMatterSchema.parse(firstValues(params));
  const shown = parseShown(params);
  const supabase = await createClient();
  const me = await myId(supabase);

  // Hidden ones are already left out by the database, except for admins (who can see them on Admin → Reports).
  // An admin sees their own here too, just like teachers do.
  const query = (chip: string) =>
    orderBy(
      bySubjectChip(
        supabase.from("presentations").select(CARD_COLUMNS, { count: "exact" }).eq("is_published", true).is("hidden_at", null).eq("from_admin", true),
        chip
      ),
      sort
    );

  // One request per subject: its first cards and its exact count (the chip's number and "See all (n)").
  const chips = [...SUBJECTS, OTHER_CHOICE, NO_SUBJECT];
  const results = await Promise.all(
    chips.map((chip) => (subject === "" ? query(chip).limit(QUIZMATTER_ROW_SIZE) : chip === subject ? query(chip).range(0, shown - 1) : query(chip).limit(0)))
  );
  for (const result of results) if (result.error) throw result.error;

  const counts = new Map(chips.map((chip, i) => [chip, results[i].count ?? 0]));
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  // Every presentation with no subject (and none with one): there are no subject rows, so it shows like a picked subject.
  const onlyNoSubject = subject === "" && total > 0 && total === counts.get(NO_SUBJECT);
  const rowsByChip = onlyNoSubject ? [] : chips.map((chip, i) => ({ chip, rows: results[i].data ?? [] }));
  const noSubjectRows = onlyNoSubject ? await query(NO_SUBJECT).range(0, shown - 1) : null;
  if (noSubjectRows?.error) throw noSubjectRows.error;

  const allRows = [...rowsByChip.flatMap((group) => group.rows), ...(noSubjectRows?.data ?? [])];
  const { toSavableCard } = await loadCardContext(supabase, allRows, me);
  const toCards = (rows: typeof allRows) =>
    rows.map((p) => ({
      ...toSavableCard(p),
      createdAt: Date.parse(p.created_at),
      updatedAt: Date.parse(p.updated_at),
    }));

  const groups = noSubjectRows
    ? [{ id: NO_SUBJECT, count: total, cards: toCards(noSubjectRows.data) }]
    : rowsByChip.map(({ chip, rows }) => ({ id: chip, count: counts.get(chip) ?? 0, cards: toCards(rows) })).filter((group) => group.cards.length > 0);

  return (
    <QuizMatterPresentations
      // Keyed by the choices, so the cards a new sort, subject or "Show more" brings get their bookmarks from the fresh data.
      key={`${subject}-${sort}-${shown}`}
      groups={groups}
      counts={Object.fromEntries(counts)}
      total={total}
      subject={subject}
      sort={sort}
      shown={shown}
      grouped={subject === "" && !onlyNoSubject}
    />
  );
}
