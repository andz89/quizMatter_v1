/**
 * "+…" in the bottom-right corner of a text on the canvas whose end is cut off, so a teacher doesn't miss it. Only in
 * the editor (never presenting or thumbnails). Its parent must be `relative`. It hangs over the box's corner,
 * a third of it outside. `inTableCell`: a cell cuts off anything outside it, so the mark sits flush in the cell's own
 * corner, past its padding (`px-2 py-1` in `TableGrid`). `onFit` (the question, answer choices and text boxes): a click makes the text smaller,
 * just enough for all of it to show (the teacher's own click, never by itself).
 */
export function HiddenTextMark({ inTableCell = false, onFit }: { inTableCell?: boolean; onFit?: () => void }) {
  return (
    <span
      data-hidden-text-mark
      title={onFit ? "Some text is hidden. Click to make the text smaller so all of it shows." : "Some text is hidden. Make the box bigger or the text smaller."}
      // A text box takes the pointer on press (to drag it), which would swallow the click: keep the press here.
      onPointerDown={onFit && ((e) => e.stopPropagation())}
      onClick={
        onFit &&
        ((e) => {
          // Only the fit: not a click on the box under it (select, a Shift+click adding it to the selection).
          e.stopPropagation();
          onFit();
        })
      }
      // Hoverable, so the tip shows. Without `onFit` (table cells) a press still reaches the box (select, drag,
      // double-click to type); with it, the press and click stay on the mark (they fit the text). Either way it
      // keeps the focus, so pressing it while typing doesn't stop the typing.
      onMouseDown={(e) => e.preventDefault()}
      // Sizes are slide pixels: the canvas is zoomed to fit the screen.
      className={`absolute z-10 ${onFit ? "cursor-pointer hover:ring-2 hover:ring-highlight-strong" : "cursor-help"} ${inTableCell ? "-right-2 -bottom-1" : "right-0 bottom-0 translate-x-1/3 translate-y-1/3"} rounded-dropdown bg-highlight px-2 py-1 font-sans text-[24px] leading-none font-semibold text-text-primary`}
    >
      +…
    </span>
  );
}
