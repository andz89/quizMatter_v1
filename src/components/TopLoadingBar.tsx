/** The app's one loading line at the top of the screen, like YouTube's. Reuse it — don't make another. */
export function TopLoadingBar() {
  return <div aria-hidden className="fixed top-0 left-0 z-50 h-[3px] animate-top-bar bg-accent-navy" />;
}
