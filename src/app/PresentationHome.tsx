"use client";

import { useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { GRADES } from "@/lib/schema";
import { LinkPending } from "@/components/LinkPending";
import { SearchField, SearchForm, SearchSelect, SearchTextInput } from "@/components/SearchForm";
import { PresentationCard, type PresentationCardData } from "./PresentationCard";
import { DEFAULT_SEARCH, homeSearchQuery, LOOK_IN, SORTS, WITHIN, type HomeSearch } from "./homeSearch";

// Only downloaded when the teacher clicks Present on a card.
const PresentationView = dynamic(() =>
  import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView)
);

// How many of my presentations the first row shows ("See all" opens the rest).
const MY_ROW_SIZE = 5;

// An admin's presentation, with its dates so "From QuizMatter" can sort by either.
export type AdminCardData = PresentationCardData & { createdAt: number; updatedAt: number };

type AdminSort = "updatedAt" | "createdAt";

const ADMIN_SORTS: { id: AdminSort; label: string }[] = [
  { id: "updatedAt", label: "Last changed" },
  { id: "createdAt", label: "Newest" },
];

/**
 * The home page's rows of cards: my newest presentations, the ones admins shared with every teacher ("From
 * QuizMatter", hidden when there are none), then presentations other teachers published. While searching, the
 * server already picked the matches (see page.tsx), so each row shows exactly what it was given.
 */
export function PresentationHome({
  myCards,
  adminCards,
  otherCards,
  search,
  isSearching,
}: {
  myCards: PresentationCardData[];
  adminCards: AdminCardData[];
  otherCards: PresentationCardData[];
  search: HomeSearch;
  isSearching: boolean;
}) {
  const [adminSort, setAdminSort] = useState<AdminSort>("updatedAt");
  const isPresenting = useEditorStore((s) => s.isPresenting);

  const shows = (section: HomeSearch["in"]) => !isSearching || search.in === "all" || search.in === section;
  const mine = isSearching ? myCards : myCards.slice(0, MY_ROW_SIZE);
  // While searching, the search's own Sort decides the order.
  const fromAdmins = isSearching ? adminCards : [...adminCards].sort((a, b) => b[adminSort] - a[adminSort]);
  const noMatch = (what: string) => `No ${what} match your search.`;

  return (
    <>
      {/* Keyed by the search, so Back (or Clear search) puts the right text back in the box. */}
      <HomeSearchForm key={homeSearchQuery(search)} search={search} />

      {isSearching && (
        <div className="mb-6 flex items-center gap-3">
          <h2 className="mr-auto min-w-0 truncate text-lg font-extrabold text-text-primary">
            {search.q ? `Results for “${search.q}”` : "Search results"}
          </h2>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-dropdown px-2.5 py-1 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
          >
            <XIcon size={14} />
            Clear search
            <LinkPending />
          </Link>
        </div>
      )}

      {shows("mine") && (
        <Section
          title="My presentations"
          action={
            !isSearching &&
            myCards.length > 0 && (
              <Link href="/presentations" className="text-sm font-semibold text-text-primary hover:underline">
                See all ({myCards.length})
              </Link>
            )
          }
        >
          {mine.length === 0 ? (
            <Empty>
              {isSearching
                ? noMatch("presentations of yours")
                : "No presentations yet. Click “+ New presentation” to make one, or ask Claude to send you one."}
            </Empty>
          ) : (
            <CardGrid>
              {mine.map((card) => (
                <PresentationCard key={card.id} card={card} showMenu />
              ))}
            </CardGrid>
          )}
        </Section>
      )}

      {shows("quizmatter") && (isSearching || adminCards.length > 0) && (
        <Section
          title="From QuizMatter"
          action={
            !isSearching && (
              <div className="flex gap-1">
                {ADMIN_SORTS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={adminSort === id}
                    onClick={() => setAdminSort(id)}
                    className={`rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                      adminSort === id ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )
          }
        >
          {fromAdmins.length === 0 ? (
            <Empty>{noMatch("QuizMatter presentations")}</Empty>
          ) : (
            <CardGrid>
              {fromAdmins.map((card) => (
                <PresentationCard key={card.id} card={card} />
              ))}
            </CardGrid>
          )}
        </Section>
      )}

      {shows("teachers") && (
        <Section title="Published by other teachers">
          {otherCards.length === 0 ? (
            <Empty>{isSearching ? noMatch("published presentations") : "No other teacher has published a presentation yet."}</Empty>
          ) : (
            <CardGrid>
              {otherCards.map((card) => (
                <PresentationCard key={card.id} card={card} />
              ))}
            </CardGrid>
          )}
        </Section>
      )}

      {isPresenting && <PresentationView />}
    </>
  );
}

/**
 * The home page's search box and its options. Enter or Search puts the search in the page link, and the server
 * looks it up in the database (page.tsx).
 */
function HomeSearchForm({ search }: { search: HomeSearch }) {
  const router = useRouter();
  const [values, setValues] = useState(search);
  const [isPending, startTransition] = useTransition();
  const set = (change: Partial<HomeSearch>) => setValues({ ...values, ...change });

  return (
    <SearchForm
      query={values.q}
      onQueryChange={(q) => set({ q })}
      placeholder="Search presentations"
      hasOptions={homeSearchQuery({ ...values, q: "" }) !== ""}
      isPending={isPending}
      // The top line and spinner show at once, and stay until the server sends the results.
      onSearch={() => startTransition(() => router.push(`/${homeSearchQuery(values)}`, { scroll: false }))}
      onClear={() => setValues(DEFAULT_SEARCH)}
      className="mx-auto mb-10 max-w-xl"
    >
      <SearchField label="Title">
        <SearchTextInput value={values.title} onChange={(title) => set({ title })} />
      </SearchField>
      <SearchField label="Subject">
        <SearchTextInput value={values.subject} onChange={(subject) => set({ subject })} />
      </SearchField>
      <SearchField label="Author">
        <SearchTextInput value={values.author} onChange={(author) => set({ author })} />
      </SearchField>
      <SearchField label="Includes the words">
        <SearchTextInput value={values.q} onChange={(q) => set({ q })} />
      </SearchField>
      <SearchField label="Doesn't have">
        <SearchTextInput value={values.not} onChange={(not) => set({ not })} />
      </SearchField>
      <SearchField label="Grade">
        <SearchSelect
          value={values.grade}
          options={[{ id: "", label: "Any grade" }, ...GRADES.map((grade) => ({ id: grade, label: grade }))]}
          onChange={(grade) => set({ grade })}
        />
      </SearchField>
      <SearchField label="Changed within">
        <SearchSelect value={values.within} options={WITHIN} onChange={(within) => set({ within })} />
      </SearchField>
      <SearchField label="Look in">
        <SearchSelect value={values.in} options={LOOK_IN} onChange={(value) => set({ in: value })} />
      </SearchField>
      <SearchField label="Sort by">
        <SearchSelect value={values.sort} options={SORTS} onChange={(sort) => set({ sort })} />
      </SearchField>
    </SearchForm>
  );
}

function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{children}</div>;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[15px] font-extrabold text-text-primary">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center text-sm text-text-secondary">
      {children}
    </p>
  );
}
