"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { LessonCard, type LessonCardData } from "./LessonCard";

// How many of my lessons the first row shows ("See all" opens the rest).
const MY_ROW_SIZE = 5;

/**
 * The home page's two rows of cards: my newest lessons, then lessons other teachers published. One
 * search box filters both; while searching, the first row shows every match, not just 5.
 */
export function LessonHome({ myCards, otherCards }: { myCards: LessonCardData[]; otherCards: LessonCardData[] }) {
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const matches = (card: LessonCardData) => `${card.title} ${card.meta} ${card.byline ?? ""}`.toLowerCase().includes(query);
  const mine = query ? myCards.filter(matches) : myCards.slice(0, MY_ROW_SIZE);
  const others = otherCards.filter(matches);

  return (
    <>
      <label className="relative mx-auto mb-10 block w-full max-w-xl">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-primary">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lessons"
          aria-label="Search lessons"
          className="w-full rounded-card border border-border-default bg-bg-surface py-3 pr-4 pl-11 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
        />
      </label>

      <Section
        title="My lessons"
        action={
          myCards.length > 0 && (
            <Link href="/lessons" className="text-sm font-semibold text-text-primary hover:underline">
              See all ({myCards.length})
            </Link>
          )
        }
      >
        {mine.length === 0 ? (
          <Empty>
            {query ? `None of your lessons match “${search.trim()}”.` : "No lessons yet. Click “+ New lesson” to make one, or ask Claude to send you one."}
          </Empty>
        ) : (
          // On phones the row scrolls sideways; on bigger screens it's a grid.
          <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
            {mine.map((card) => (
              <div key={card.id} className="w-44 shrink-0 snap-start sm:w-auto">
                <LessonCard card={card} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Published by other teachers">
        {others.length === 0 ? (
          <Empty>{query ? `No published lessons match “${search.trim()}”.` : "No other teacher has published a lesson yet."}</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {others.map((card) => (
              <LessonCard key={card.id} card={card} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
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

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}
