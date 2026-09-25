export function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
    </svg>
  );
}
