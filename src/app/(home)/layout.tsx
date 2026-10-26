import { Suspense, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BanIcon } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { NewPresentationButton } from "../PresentationListButtons";
import type { MyReviewRow } from "../MyReviews";
import { myId } from "./cards";
import { HomeSearchForm } from "./HomeSearchForm";
import { HomeTabs, type HomeTab } from "./HomeTabs";

/** Shared by every home page (/, /quizmatter, /reviews-submissions, /saved, /liked, /teachers, /search): title, search box and tabs. */
export default async function HomeLayout({ children }: { children: ReactNode }) {
  const account = await getAccount();
  // Banned (Admin → Teachers): every home page only says so, until Supabase's ban ends their login (see proxy.ts).
  if (account.isBanned) return <BlockedHome />;
  const supabase = await createClient();
  const me = await myId(supabase);
  const counts = await loadTabCounts(supabase, me, account.isEditor);

  return (
    <>
      <NavBar />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-wrap items-center gap-4">
          <div className="mr-auto">
            <h1 className="text-2xl font-extrabold text-text-primary">Presentations</h1>
            <p className="mt-1 text-sm text-text-secondary">Your presentations, and the ones other teachers published.</p>
          </div>
          <NewPresentationButton author={account.displayName} />
        </header>

        {/* Reads the search from the address, so it waits for it in the browser. */}
        <Suspense>
          <HomeSearchForm />
        </Suspense>
        <div className="mb-4">
          <HomeTabs counts={counts} isEditor={account.isEditor} isAdmin={account.isAdmin} />
        </div>
        {children}
      </main>
    </>
  );
}

/**
 * The number on each tab. Only counts come back (no rows), with the same filters as each page. Claude's drafts
 * aren't counted, so no page waits for them here.
 */
async function loadTabCounts(supabase: SupabaseClient, me: string, isEditor: boolean): Promise<Record<HomeTab, number>> {
  const count = () => supabase.from("presentations").select("id", { count: "exact", head: true });
  const [mine, quizmatter, teachers, saved, liked, reviewed, myReviews, mySubmissions] = await Promise.all([
    // QuizMatter presentations an admin made are on Admin → Presentations, not in "mine".
    count().eq("owner_id", me).eq("from_admin", false).is("shared_from", null),
    count().eq("is_published", true).is("hidden_at", null).eq("from_admin", true),
    count().eq("is_published", true).is("hidden_at", null).eq("from_admin", false).neq("owner_id", me),
    // "!inner" keeps only presentations with a saved row, and the database only gives back my own saved rows.
    supabase
      .from("presentations")
      .select("id, saved_presentations!inner(presentation_id)", { count: "exact", head: true })
      .eq("is_published", true)
      .is("hidden_at", null)
      .neq("owner_id", me),
    // Same for my likes (see the presentation_likes migration).
    supabase
      .from("presentations")
      .select("id, presentation_likes!inner(presentation_id)", { count: "exact", head: true })
      .eq("is_published", true)
      .is("hidden_at", null)
      .neq("owner_id", me),
    // Editors: the live QuizMatter presentations I reviewed, and my open and canceled review rounds.
    isEditor
      ? supabase
          .from("presentations")
          .select("id, presentation_reviewers!inner(reviewer_id)")
          .eq("presentation_reviewers.reviewer_id", me)
          .eq("is_published", true)
          .is("hidden_at", null)
          .eq("from_admin", true)
      : { data: [], error: null },
    isEditor ? supabase.rpc("my_reviews") : { data: [] as MyReviewRow[], error: null },
    // Editors: my presentations sent to QuizMatter (see the quizmatter_submissions migration).
    isEditor ? supabase.rpc("my_submissions") : { data: [] as { id: string }[], error: null },
  ]);
  for (const result of [mine, quizmatter, teachers, saved, liked, reviewed, myReviews, mySubmissions]) if (result.error) throw result.error;

  return {
    mine: mine.count ?? 0,
    quizmatter: quizmatter.count ?? 0,
    teachers: teachers.count ?? 0,
    saved: saved.count ?? 0,
    liked: liked.count ?? 0,
    // A presentation I'm reviewing again is in two parts, but counts once (and my submissions are other presentations).
    reviewed: new Set([
      ...(reviewed.data ?? []).map((row) => row.id as string),
      ...((myReviews.data ?? []) as MyReviewRow[]).map((row) => row.presentation_id),
      // By receipt id: one whose original I deleted has no presentation id.
      ...((mySubmissions.data ?? []) as { id: string }[]).map((row) => row.id),
    ]).size,
  };
}

function BlockedHome() {
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <div className="rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger-strong">
            <BanIcon size={24} />
          </span>
          <h1 className="text-xl font-extrabold text-text-primary">Your account is blocked</h1>
          <p className="mt-2 text-sm text-text-secondary">
            You can&apos;t open or make presentations anymore. If you think this is a mistake, contact QuizMatter. You can
            log out from the round button at the top right.
          </p>
        </div>
      </main>
    </>
  );
}
