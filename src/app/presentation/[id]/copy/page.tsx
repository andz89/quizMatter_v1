import type { Metadata } from "next";
import { z } from "zod";
import { NavBar } from "@/components/NavBar";
import { fetchPresentation } from "@/lib/fetchPresentation";
import { CopyProblem, MakeCopy } from "./MakeCopy";

export const metadata: Metadata = { title: "Making a copy" };

/**
 * "Make a copy" opens this page in a new tab: it makes my private copy of the presentation and then shows it in the
 * editor (MakeCopy). Logged in only (the proxy sends others to login). The presentation is read the same way as its
 * page, so a private or unknown one says so here instead.
 */
export default async function CopyPresentationPage({ params }: PageProps<"/presentation/[id]/copy">) {
  const { id } = await params;
  // A broken link (not an id) would make the database fail.
  const result = z.uuid().safeParse(id).success ? await fetchPresentation(id) : null;
  return (
    <>
      <NavBar />
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-4 py-16">
        {result ? (
          <MakeCopy presentation={result.presentation} />
        ) : (
          <CopyProblem presentationId={null} message="This presentation is private now or was deleted, so it can't be copied." />
        )}
      </main>
    </>
  );
}
