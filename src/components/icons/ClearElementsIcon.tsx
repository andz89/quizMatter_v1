/** A square and circle (the "elements" shapes) with a small x — "remove the elements". */
export function ClearElementsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <circle cx="7" cy="17" r="4" />
      <circle cx="17" cy="7" r="4" />
      <path d="M14.5 14.5l5 5M19.5 14.5l-5 5" />
    </svg>
  );
}
