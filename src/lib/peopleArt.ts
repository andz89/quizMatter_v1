import type { ReactNode } from "react";
import type { Slide } from "./schema";

// The traced people (the School Boy and the clipart students) are big: about 300 KB of shapes. So their
// drawings are a separate download (schoolBoy.tsx and clipartKids.tsx), fetched only when something needs
// them: a presentation that uses one waits for it before it opens (see PeopleArtGate), and any other
// picture of one (Elements panel tiles, cards on the home page) shows the Spinner until it arrives.
// Their names, colors, and drawing areas stay here, so the rest of the app can use them right away.

export const SCHOOL_BOY = { id: "school-boy", label: "School Boy", defaultColor: "#F2A93B", viewBox: "0 0 938 2074" };

export const CLIPART_KIDS = [
  { id: "student-pencil", label: "Student with Pencil", defaultColor: "#7048E8", viewBox: "0 0 564.1 1207" },
  { id: "student-reading", label: "Student Reading", defaultColor: "#2F9E44", viewBox: "0 0 519.6 1177.1" },
  { id: "student-apple", label: "Student with Apple", defaultColor: "#4263EB", viewBox: "0 0 580.6 1149.4" },
  { id: "student-book", label: "Student with Book", defaultColor: "#1F1F1F", viewBox: "0 0 675.9 1182.1" },
  { id: "student-globe", label: "Student with Globe", defaultColor: "#1971C2", viewBox: "0 0 681 1104.8" },
  { id: "student-backpack", label: "Student with Backpack", defaultColor: "#0CA678", viewBox: "0 0 463.9 1107.7" },
  { id: "student-paper", label: "Student with Paper", defaultColor: "#495057", viewBox: "0 0 784.1 1116.7" },
  { id: "student-pointing", label: "Student Pointing Up", defaultColor: "#F08C00", viewBox: "0 0 581.2 1115.6" },
  { id: "student-hooray", label: "Hooray Student", defaultColor: "#0CA678", viewBox: "0 0 1165.4 1959" },
];

const PEOPLE_ART_IDS = new Set([SCHOOL_BOY.id, ...CLIPART_KIDS.map((kid) => kid.id)]);

let drawings: Record<string, (color: string) => ReactNode> | null = null;
let loading: Promise<void> | null = null;

async function download() {
  const [{ renderSchoolBoy }, { CLIPART_KID_DRAWINGS }] = await Promise.all([import("./schoolBoy"), import("./clipartKids")]);
  drawings = { [SCHOOL_BOY.id]: renderSchoolBoy, ...CLIPART_KID_DRAWINGS };
}

/** Downloads the drawings once (trying a second time if the first try fails); every caller shares that one download. */
export function loadPeopleArt(): Promise<void> {
  loading ??= download()
    .catch(download)
    .catch((error) => {
      // Forgotten, so the next call (e.g. "Try again") starts a new download.
      loading = null;
      throw error;
    });
  return loading;
}

export const isPeopleArt = (assetId: string) => PEOPLE_ART_IDS.has(assetId);

export const isPeopleArtLoaded = () => drawings !== null;

/** Draws one of these people, or nothing if the drawings haven't downloaded yet. */
export const drawPeopleArt = (assetId: string, color: string): ReactNode => drawings?.[assetId]?.(color) ?? null;

export const usesPeopleArt = (slides: Slide[]) => slides.some((slide) => slide.elements.some((element) => isPeopleArt(element.assetId)));
