import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DRAFT_LIFETIME_MS, listDrafts, type DraftSummary } from "@/lib/drafts";
import { joinParts, timeAgo } from "@/lib/format";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { NewPresentationButton } from "../PresentationListButtons";
import { PresentationList, type PresentationRow } from "./PresentationList";

/** "See all" from the home page: every presentation of mine and every draft from Claude, as a table. */
export default async function AllPresentationsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const [{ data: presentations, error }, drafts, account] = await Promise.all([
    supabase
      .from("presentations")
      .select("id, title, grade, subject, is_published, updated_at, slides(count)")
      // Other teachers' published presentations are readable too, so only take mine.
      .eq("owner_id", claims?.claims.sub ?? "")
      // QuizMatter presentations an admin made are on Admin → Presentations, not here.
      .eq("from_admin", false)
      .order("updated_at", { ascending: false }),
    // An admin's drafts from Claude become QuizMatter presentations, so they're on Admin → Presentations.
    getAccount().then((account) => (account.isAdmin ? [] : listDrafts())),
    getAccount(),
  ]);
  if (error) throw error;

  const rows = buildRows(presentations, drafts);

  return (
    <>
      <NavBar>
        <Link href="/" className={navLinkClass}>
          Home
          <LinkPending />
        </Link>
      </NavBar>

      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-wrap items-center gap-4">
          <div className="mr-auto">
            <h1 className="text-2xl font-extrabold text-text-primary">All my presentations</h1>
            <p className="mt-1 text-sm text-text-secondary">Your saved presentations, and the ones Claude sent you.</p>
          </div>
          <NewPresentationButton author={account.displayName} />
        </header>

        <PresentationList rows={rows} />
      </main>
    </>
  );
}

type SavedPresentation = {
  id: string;
  title: string;
  grade: string;
  subject: string;
  is_published: boolean;
  updated_at: string;
  slides: { count: number }[];
};

/** Saved presentations and Claude's drafts as one list, newest first. */
function buildRows(presentations: SavedPresentation[], drafts: DraftSummary[]): PresentationRow[] {
  const now = Date.now();
  const savedIds = new Set(presentations.map((presentation) => presentation.id));
  return [
    ...presentations.map((presentation) => {
      const updatedAt = Date.parse(presentation.updated_at);
      return {
        id: presentation.id,
        title: presentation.title || "Untitled presentation",
        meta: joinParts([presentation.grade, presentation.subject]),
        status: "saved" as const,
        isPublished: presentation.is_published,
        slideCount: presentation.slides[0]?.count ?? 0,
        sortTime: updatedAt,
        dateLabel: timeAgo(updatedAt, now),
      };
    }),
    // A draft whose presentation is already saved is done (the saved presentation took the draft's id — see /presentation/new).
    ...drafts
      .filter((draft) => !savedIds.has(draft.id))
      .map((draft) => ({
        id: draft.id,
        title: draft.title || "Untitled presentation",
        meta: joinParts([draft.grade, draft.subject]),
        status: "draft" as const,
        slideCount: draft.slideCount,
        sortTime: draft.createdAt,
        dateLabel: timeAgo(draft.createdAt, now),
        checking: draft.state === "checking",
        note: {
          ready: `From Claude · not saved yet · ${expiresIn(draft.createdAt + DRAFT_LIFETIME_MS - now)}`,
          checking: "From Claude · checking the layout",
          unfinished: `From Claude · Not finished: Claude didn't send the final version · ${expiresIn(draft.createdAt + DRAFT_LIFETIME_MS - now)}`,
        }[draft.state],
      })),
  ].sort((a, b) => b.sortTime - a.sortTime);
}

function expiresIn(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `expires in ${hours} hr` : "expires soon";
}
