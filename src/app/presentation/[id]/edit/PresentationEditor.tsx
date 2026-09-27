"use client";

import dynamic from "next/dynamic";
import type { Presentation } from "@/lib/schema";

// The editor's store makes a placeholder presentation with crypto.randomUUID() at module load — rendering it
// on the server would bake one set of random ids into the SSR HTML while the client generates a
// different set during hydration, leaving stale ids on the DOM (e.g. data-container-id) that never
// match the live React state. Skipping SSR avoids the mismatch entirely.
const Editor = dynamic(() => import("@/components/editor/Editor").then((mod) => mod.Editor), { ssr: false });

export function PresentationEditor({ presentation, draft }: { presentation: Presentation; draft?: unknown }) {
  return <Editor presentation={presentation} draft={draft} />;
}
