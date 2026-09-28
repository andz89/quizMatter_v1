export function PhotoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="5.75" cy="6.25" r="1.1" />
      <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" strokeLinecap="round" />
    </svg>
  );
}
