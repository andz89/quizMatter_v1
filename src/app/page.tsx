"use client";

import dynamic from "next/dynamic";

// The editor's initial state is generated with crypto.randomUUID() at module load — rendering it
// on the server would bake one set of random ids into the SSR HTML while the client generates a
// different set during hydration, leaving stale ids on the DOM (e.g. data-container-id) that never
// match the live React state. Skipping SSR avoids the mismatch entirely.
const Editor = dynamic(() => import("@/components/editor/Editor").then((mod) => mod.Editor), { ssr: false });

export default function Home() {
  return <Editor />;
}
