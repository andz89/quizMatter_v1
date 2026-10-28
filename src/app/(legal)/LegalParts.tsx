import type { ReactNode } from "react";
import { formatDay } from "@/lib/format";
import { LEGAL_VERSION } from "@/lib/legal";

// The parts the Privacy Policy and Terms of Use pages are built from, so both look the same.

/** The page title and "Last updated", from LEGAL_VERSION. */
export function LegalTitle({ title }: { title: string }) {
  return (
    <header>
      <h1 className="text-2xl font-extrabold text-text-primary">{title}</h1>
      <p className="mt-1 text-sm text-text-secondary">Last updated: {formatDay(LEGAL_VERSION)}</p>
    </header>
  );
}

/** "The short version": a soft violet box at the top. */
export function ShortVersion({ children }: { children: ReactNode }) {
  return (
    <section className="mt-6 rounded-button bg-accent-soft px-4 py-3">
      <h2 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">The short version</h2>
      <div className="mt-2 text-sm leading-relaxed text-text-primary [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** One numbered part of the page: a heading and its text (paragraphs, bullet lists, a small table). */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-extrabold text-text-primary">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed break-words text-text-primary [&_a]:font-semibold [&_a]:text-accent [&_a:hover]:underline [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
