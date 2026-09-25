export function DuplicateIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="1.5" width="8" height="8" rx="1.2" />
      <path d="M4.5 12.5h6a2 2 0 0 0 2-2v-6" strokeLinecap="round" />
    </svg>
  );
}
