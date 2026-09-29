"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { GRADES } from "@/lib/schema";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { PresentationCard, type PresentationCardData } from "./PresentationCard";
import { DEFAULT_SEARCH, homeSearchQuery, LOOK_IN, SEARCH_MAX_LENGTH, SORTS, WITHIN, type HomeSearch } from "./homeSearch";

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
      <SearchForm key={homeSearchQuery(search)} search={search} />

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
 * The search box, with a Gmail-style panel of search options under it (the sliders button opens it). Nothing
 * happens while typing: Enter or Search puts the search in the page link, and the server looks it up in the database.
 */
function SearchForm({ search }: { search: HomeSearch }) {
  const router = useRouter();
  const [values, setValues] = useState(search);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Like a menu: a click outside the box or Escape closes the panel.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!formRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const set = (change: Partial<HomeSearch>) => setValues({ ...values, ...change });
  // Any option besides the main text is set, so the sliders button shows it.
  const hasOptions = homeSearchQuery({ ...values, q: "" }) !== "";

  return (
    <form
      ref={formRef}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        setIsOpen(false);
        // The top line and spinner show at once, and stay until the server sends the results.
        startTransition(() => router.push(`/${homeSearchQuery(values)}`, { scroll: false }));
      }}
      className="relative mx-auto mb-10 w-full max-w-xl"
    >
      {isPending && <TopLoadingBar />}

      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-primary">
          <SearchIcon size={16} />
        </span>
        <input
          type="search"
          value={values.q}
          onChange={(e) => set({ q: e.target.value })}
          maxLength={SEARCH_MAX_LENGTH}
          placeholder="Search presentations"
          aria-label="Search presentations"
          className={`w-full rounded-card border border-border-default bg-bg-surface py-3 pl-11 ${isOpen ? "pr-14" : "pr-36"} text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary`}
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-label="Search options"
            title="Search options"
            className={`rounded-dropdown p-2 transition-colors hover:bg-accent-soft ${hasOptions || isOpen ? "text-accent" : "text-text-primary"}`}
          >
            <SlidersHorizontalIcon size={16} />
          </button>
          {/* The open panel has its own Search button, so this one hides until the panel closes. */}
          {!isOpen && (
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 rounded-button bg-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-70"
            >
              {isPending && <Spinner size={14} />}
              Search
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full right-0 left-0 z-30 mt-2 rounded-card border border-border-default bg-bg-surface px-5 py-4">
          <div className="grid grid-cols-1 items-center gap-x-4 gap-y-3 sm:grid-cols-[140px_1fr]">
            <Field label="Title">
              <TextInput value={values.title} onChange={(title) => set({ title })} />
            </Field>
            <Field label="Subject">
              <TextInput value={values.subject} onChange={(subject) => set({ subject })} />
            </Field>
            <Field label="Author">
              <TextInput value={values.author} onChange={(author) => set({ author })} />
            </Field>
            <Field label="Includes the words">
              <TextInput value={values.q} onChange={(q) => set({ q })} />
            </Field>
            <Field label="Doesn't have">
              <TextInput value={values.not} onChange={(not) => set({ not })} />
            </Field>
            <Field label="Grade">
              <Select
                value={values.grade}
                options={[{ id: "", label: "Any grade" }, ...GRADES.map((grade) => ({ id: grade, label: grade }))]}
                onChange={(grade) => set({ grade })}
              />
            </Field>
            <Field label="Changed within">
              <Select value={values.within} options={WITHIN} onChange={(within) => set({ within })} />
            </Field>
            <Field label="Look in">
              <Select value={values.in} options={LOOK_IN} onChange={(value) => set({ in: value })} />
            </Field>
            <Field label="Sort by">
              <Select value={values.sort} options={SORTS} onChange={(sort) => set({ sort })} />
            </Field>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setValues(DEFAULT_SEARCH)}
              className="rounded-button px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-press flex items-center gap-2 rounded-button bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-70"
            >
              {isPending && <Spinner size={14} />}
              Search
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

/** One row of the search options panel: a label, then its box. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="contents">
      <span className="text-sm text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

const optionInputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary";

function TextInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={SEARCH_MAX_LENGTH} className={optionInputClass} />;
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={optionInputClass}>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
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
