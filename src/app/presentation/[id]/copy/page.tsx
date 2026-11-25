import type { Metadata } from "next";
import { z } from "zod";
import { NavBar } from "@/components/NavBar";
import { loadPresentation } from "@/lib/fetchPresentation";
import { REFUSALS } from "@/lib/presentations";
import { loadReviewStatus } from "@/lib/reviewStatus";
import { isNewerThanApp, type Presentation } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { CopyProblem, MakeCopy, type CopyRefusal } from "./MakeCopy";

export const metadata: Metadata = { title: "Making a copy" };

/**
 * "Make a copy" opens this page in a new tab (`?as=<the copy's new id>`, with a ticket in localStorage, see
 * copyTicket.ts): it makes my private copy of the presentation and then shows it in the editor (MakeCopy). Logged in
 * only (the proxy sends others to login). Here only what the copy needs is read: the presentation, whether it's under
 * review, and which app version saved it.
 */
export default async function CopyPresentationPage({ params, searchParams }: PageProps<"/presentation/[id]/copy">) {
  const { id } = await params;
  const { as } = await searchParams;
  const copyId = z.uuid().safeParse(as);
  let body;
  if (!z.uuid().safeParse(id).success || !copyId.success) {
    body = <CopyProblem backTo={null} message="This copy link only works from the Make a copy button." />;
  } else {
    let presentation: Presentation | null = null;
    let refusal: CopyRefusal | null = null;
    try {
      const supabase = await createClient();
      const [loaded, review, version] = await Promise.all([
        loadPresentation(supabase, id),
        // It fails for an id that isn't there: whether it is comes first, below.
        loadReviewStatus(supabase, id).catch(() => null),
        supabase.from("presentations").select("data_version").eq("id", id).maybeSingle(),
      ]);
      // The database hides someone else's private presentation, so finding nothing means it's private (or gone).
      if (!loaded) refusal = { kind: "private", message: "This presentation is private now or was deleted, so it can't be copied." };
      else if (!review) throw new Error("Couldn't read the review status.");
      else if (review.isLocked) refusal = { kind: "locked", message: "This presentation is under review, so it can't be copied right now." };
      // Saved by newer app code than this tab runs: copying it here would drop fields this tab doesn't know.
      else if (version.data && isNewerThanApp(version.data.data_version)) refusal = { kind: "old", message: REFUSALS.QMOLD };
      else presentation = loaded.presentation;
    } catch {
      body = <CopyProblem backTo={id} message="Couldn't load the presentation. Please try again." />;
    }
    body ??= <MakeCopy presentationId={id} copyId={copyId.data} presentation={presentation} refusal={refusal} />;
  }
  return (
    <>
      <NavBar />
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-4 py-16">{body}</main>
    </>
  );
}
