import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { NavBar } from "@/components/NavBar";

// Shown for a wrong address and every notFound() (a deleted or hidden presentation, an unknown teacher, an admin
// page a teacher can't open).
export default function NotFound() {
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <div className="rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <SearchXIcon size={24} />
          </span>
          <h1 className="text-xl font-extrabold text-text-primary">Page not found</h1>
          <p className="mt-2 text-sm text-text-secondary">
            This page or presentation doesn&apos;t exist. It may have been deleted, or the link is wrong.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Go to home
            <LinkPending />
          </Link>
        </div>
      </main>
    </>
  );
}
