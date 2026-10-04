"use client";

import dynamic from "next/dynamic";
import type { Presentation } from "@/lib/schema";
import { usesPeopleArt } from "@/lib/peopleArt";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import type { EditorReview } from "@/lib/store";

// The editor's store makes a placeholder presentation with crypto.randomUUID() at module load — rendering it
// on the server would bake one set of random ids into the SSR HTML while the client generates a
// different set during hydration, leaving stale ids on the DOM (e.g. data-container-id) that never
// match the live React state. Skipping SSR avoids the mismatch entirely.
const Editor = dynamic(() => import("@/components/editor/Editor").then((mod) => mod.Editor), { ssr: false });

// `review`: set when an editor opens their review of someone else's QuizMatter presentation (see Editor).
export function PresentationEditor({
  presentation,
  draft,
  review,
}: {
  presentation: Presentation;
  draft?: unknown;
  review?: EditorReview;
}) {
  // A draft from Claude is only a recipe until the editor builds its slides, so it always waits for the
  // people art (Claude often puts the clipart students in).
  return (
    <PeopleArtGate needed={draft !== undefined || usesPeopleArt(presentation.slides)}>
      <Editor presentation={presentation} draft={draft} review={review} />
    </PeopleArtGate>
  );
}
