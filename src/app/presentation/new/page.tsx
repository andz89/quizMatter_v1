import Link from "next/link";
import { redirect } from "next/navigation";
import { createBlankPresentation } from "@/lib/factories";
import { getDraft } from "@/lib/drafts";
import { createClient } from "@/lib/supabase/server";
import { PresentationEditor } from "../[id]/edit/PresentationEditor";

/**
 * Opens a presentation Claude sent through the MCP server (the link /api/mcp hands out) as a new presentation. It
 * isn't saved yet: the editor shows it, and the user's Save creates it in the database.
 *
 * The new presentation takes the draft's id, so once it's saved the presentation list knows this draft is done
 * (and hides it), and opening the link again opens the saved presentation instead of a second copy.
 */
export default async function NewPresentationFromClaudePage({ searchParams }: PageProps<"/presentation/new">) {
  const { draft: draftId } = await searchParams;
  if (typeof draftId !== "string") redirect("/");

  const supabase = await createClient();
  const { data: savedPresentation } = await supabase.from("presentations").select("id").eq("id", draftId).maybeSingle();
  if (savedPresentation) redirect(`/presentation/${draftId}/edit`);

  const draft = await getDraft(draftId);
  if (!draft) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
          <h1 className="mb-2 text-base font-semibold text-text-primary">This link has expired</h1>
          <p className="mb-5 text-sm text-text-secondary">
            Presentations from Claude stay for 24 hours. Ask Claude to send the presentation again.
          </p>
          <Link href="/" className="text-sm font-semibold text-accent-green">
            Back to my presentations
          </Link>
        </div>
      </main>
    );
  }

  const presentation = { ...createBlankPresentation(draft.details), id: draftId };
  return <PresentationEditor presentation={presentation} draft={{ slides: draft.slides }} />;
}
