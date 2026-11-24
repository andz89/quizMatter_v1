import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { LinkPending } from "@/components/LinkPending";
import { LoggedOutBar } from "@/components/LoggedOutBar";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { getPublicPresentation, publicDescription } from "@/lib/publicPresentation";
import { usesPeopleArt } from "@/lib/peopleArt";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { loadPresentationView } from "./loadView";
import { PresentationDetails } from "./PresentationDetails";
import { PublicPresentation } from "./PublicPresentation";

/**
 * The tags search engines and link previews read (the picture comes from opengraph-image.tsx next to this page).
 * Only a published presentation gets its own; anything else is "QuizMatter" and kept out of search results.
 * Read only for logged-out visitors (robots are always logged out); logged in, the page keeps the default title and
 * makes no extra read. getAccount is shared with the page (one lookup per request).
 */
export async function generateMetadata({ params }: PageProps<"/presentation/[id]">): Promise<Metadata> {
  const { id } = await params;
  if ((await getAccount()).id) return { title: "Presentation" };
  const preview = z.uuid().safeParse(id).success ? await getPublicPresentation(id) : null;
  if (!preview) return { title: { absolute: "QuizMatter" }, robots: { index: false } };
  const title = preview.title || "Untitled presentation";
  const description = publicDescription(preview);
  return {
    title: { absolute: `${title} · QuizMatter` },
    description,
    // A page's openGraph replaces the root layout's, so the site name is given again.
    openGraph: { type: "article", siteName: "QuizMatter", url: `/presentation/${id}`, title, description },
    alternates: { canonical: `/presentation/${id}` },
  };
}

/**
 * A presentation to look at, not edit, opened by its link (a shared link, Admin → Reports, My submissions, a reload).
 * Clicking a card opens the same thing in a modal instead (src/app/PresentationModal.tsx).
 */
export default async function PresentationPage({ params }: PageProps<"/presentation/[id]">) {
  const { id } = await params;
  // A broken link (not an id) would make the database fail; it's simply not found.
  if (!z.uuid().safeParse(id).success) notFound();
  const account = await getAccount();
  // Logged out (a visitor or a robot): a published one's public preview, else login, exactly as before.
  if (!account.id) {
    const preview = await getPublicPresentation(id);
    if (!preview) redirect(`/login?next=${encodeURIComponent(`/presentation/${id}`)}`);
    return (
      <>
        <LoggedOutBar />
        <PublicPresentation presentation={preview} />
      </>
    );
  }
  const view = await loadPresentationView(id);
  // Someone else's private presentation is hidden by the database, so it looks like it doesn't exist.
  if (!view) notFound();

  return (
    <>
      <NavBar>
        <Link href="/" className={navLinkClass}>
          Home
          <LinkPending />
        </Link>
      </NavBar>
      <PeopleArtGate needed={usesPeopleArt(view.presentation.slides)}>
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-10">
          <PresentationDetails view={view} />
        </main>
      </PeopleArtGate>
    </>
  );
}
