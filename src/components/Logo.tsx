/**
 * The QuizMatter logo: the "Q-Check" mark (a Q whose tail is a check mark: a question and a right
 * answer in one) plus the "QuizMatter" word. Same drawing as src/app/icon.svg (the browser tab icon).
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="18" fill="var(--accent)" />
        <circle cx="30" cy="30" r="14" fill="none" stroke="#fff" strokeWidth="7" />
        <path d="M36 41 L42 47 L53 33" fill="none" stroke="var(--highlight)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {/* The word grows with the mark: 20px at the default size. */}
      <span className="font-heading font-extrabold tracking-[-0.03em] text-text-primary" style={{ fontSize: size * 0.66 }}>
        Quiz<span className="text-accent">Matter</span>
      </span>
    </span>
  );
}
