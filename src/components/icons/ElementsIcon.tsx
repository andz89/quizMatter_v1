export function ElementsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3.5" />
      <rect x="9" y="9" width="6" height="6" rx="1.2" />
    </svg>
  );
}
