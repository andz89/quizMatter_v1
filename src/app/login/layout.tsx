import type { Metadata } from "next";
import type { ReactNode } from "react";

// The login page is a client component, so its title lives here.
export const metadata: Metadata = { title: "Log in" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
