import type { Metadata } from "next";
import type { ReactNode } from "react";

// Forgot password is a client component, so its title lives here (kept out of search results).
export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
