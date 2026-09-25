export function BackgroundIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <rect x="5" y="6" width="6" height="4" rx="1" />
    </svg>
  );
}
