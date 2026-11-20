import type { Metadata } from "next";
import type { ReactNode } from "react";

// The two-step page is a client component, so its title lives here (kept out of search results).
export const metadata: Metadata = { title: "Two-step login", robots: { index: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
