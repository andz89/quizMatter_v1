import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { listDrafts, type DraftSummary } from "@/lib/drafts";
import { PAGE_SIZE, homeSearchQuery, parseHomeSearch } from "../homeSearch";
import type { SubmissionStatus } from "@/lib/submissions";
import { CARD_COLUMNS, draftCard, myCard, myId, mySubmissionStatuses, orderBy, type CardPresentation } from "./cards";
import { MyPresentations } from "./MyPresentations";

/** My presentations and Claude's drafts, newest changed first, with my folders. */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  // Old links had the search on "/" (e.g. /?q=fractions); it has its own page now. "shown" alone isn't a search.
  const search = parseHomeSearch(await searchParams);
  if (homeSearchQuery({ ...search, shown: PAGE_SIZE }) !== "") redirect(`/search${homeSearchQuery(search)}`);

  const account = await getAccount();
  const supabase = await createClient();
  const me = await myId(supabase);

  const [mine, drafts, folders, folderItems, submissionOf] = await Promise.all([
    // QuizMatter presentations an admin made are on Admin → Presentations, not here.
    orderBy(supabase.from("presentations").select(CARD_COLUMNS).eq("owner_id", me).eq("from_admin", false), "updated"),
    // An admin's drafts from Claude become QuizMatter presentations, so they're on Admin → Presentations.
    account.isAdmin ? [] : listDrafts(account.id),
    // My folders, and which of my presentations is in which (see the folders migration).
    supabase.from("folders").select("id, name").order("name"),
    supabase.from("folder_items").select("presentation_id, folder_id"),
    // Editors: which of mine were sent to QuizMatter, for the card's label and menu.
    mySubmissionStatuses(supabase, account.isEditor),
  ]);
  if (mine.error) throw mine.error;
  if (folders.error) throw folders.error;
  if (folderItems.error) throw folderItems.error;

  const folderOf = new Map(folderItems.data.map((item) => [item.presentation_id, item.folder_id]));
  const myCards = buildMyCards(mine.data, drafts, account, submissionOf).map((card) => ({ ...card, folderId: folderOf.get(card.id) }));

  return (
    <MyPresentations
      myCards={myCards}
      folders={folders.data.map((folder) => ({
        ...folder,
        count: mine.data.filter((presentation) => folderOf.get(presentation.id) === folder.id).length,
      }))}
    />
  );
}

/** My presentations and Claude's drafts that aren't saved yet (see /presentations) as cards, last changed first. */
function buildMyCards(
  mine: CardPresentation[],
  drafts: DraftSummary[],
  account: { isSuperAdmin: boolean; isEditor: boolean },
  submissionOf: Map<string, SubmissionStatus>,
) {
  const now = Date.now();
  const savedIds = new Set(mine.map((presentation) => presentation.id));
  return [
    ...mine.map((presentation) =>
      myCard(presentation, account.isSuperAdmin, now, { isEditor: account.isEditor, submission: submissionOf.get(presentation.id) }),
    ),
    ...drafts.filter((draft) => !savedIds.has(draft.id)).map((draft) => draftCard(draft, now)),
    // Drafts are mixed in, so the order the database gave is sorted again here.
  ].sort((a, b) => b.updatedAt - a.updatedAt);
}
