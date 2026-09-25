/**
 * Drawn over a box whose text doesn't fit: a red border, and a "+" at its bottom-right corner to say
 * there's more text than shows. Editor only — the presentation just cuts the text off.
 * Put it inside the box (which must be `relative`).
 */
export function TextOverflowMark() {
  return (
    <div className="pointer-events-none absolute -inset-px z-10 rounded-[inherit] border border-accent-red">
      <span
        title="The text doesn't fit. Make the text smaller or shorter, or the box bigger."
        className="pointer-events-auto absolute -bottom-2.5 -right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-red text-sm font-semibold leading-none text-white"
      >
        +
      </span>
    </div>
  );
}
