/** The app's one loading spinner. Reuse it everywhere — don't make another. */
export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block animate-spin rounded-full border-2 border-border-default border-t-text-primary"
      style={{ width: size, height: size }}
    />
  );
}
