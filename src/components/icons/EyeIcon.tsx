export function EyeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 9C3.2 5.8 5.9 4 9 4s5.8 1.8 7.5 5c-1.7 3.2-4.4 5-7.5 5S3.2 12.2 1.5 9Z" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2.25" />
    </svg>
  );
}
