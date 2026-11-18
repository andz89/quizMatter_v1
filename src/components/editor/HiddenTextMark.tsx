/**
 * "+…" in the bottom-right corner of a text on the canvas whose end is cut off, so a teacher doesn't miss it. Only in
 * the editor (never presenting or thumbnails). Its parent must be `relative`. It hangs over the box's corner,
 * a third of it outside. `inTableCell`: a cell cuts off anything outside it, so the mark sits flush in the cell's own
 * corner, past its padding (`px-2 py-1` in `TableGrid`).
 */
export function HiddenTextMark({ inTableCell = false }: { inTableCell?: boolean }) {
  return (
    <span
      data-hidden-text-mark
      title="Some text is hidden. Make the box bigger or the text smaller."
      // Hoverable, so the tip shows; a press still reaches the box (select, drag, double-click to type), but
      // keeps the focus, so pressing it while typing doesn't stop the typing.
      onMouseDown={(e) => e.preventDefault()}
      // Sizes are slide pixels: the canvas is zoomed to fit the screen.
      className={`absolute z-10 cursor-help ${inTableCell ? "-right-2 -bottom-1" : "right-0 bottom-0 translate-x-1/3 translate-y-1/3"} rounded-dropdown bg-highlight px-2 py-1 font-sans text-[24px] leading-none font-semibold text-text-primary`}
    >
      +…
    </span>
  );
}
