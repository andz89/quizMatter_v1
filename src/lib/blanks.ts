/**
 * Fill-in blanks ("___"). Lexend draws `_` narrower than the room it takes, so a row of them shows gaps. A run of two
 * or more gets the `qm-blank` class (globals.css: a little tighter letter spacing), which joins it into one line.
 * Display only: the saved text keeps the underscores as typed. The editor marks them with `BlankLines`
 * (`blankLines.ts`), the read-only text with `markBlanks`. No imports, so `blanks.test.ts` loads it.
 */

export const BLANK_CLASS = "qm-blank";

/** Each run of two or more underscores in `text`, as [start, end) character positions. */
export function blankRuns(text: string): [number, number][] {
  const runs: [number, number][] = [];
  for (const match of text.matchAll(/_{2,}/g)) runs.push([match.index, match.index + match[0].length]);
  return runs;
}

/** Wraps each run of underscores in `root`'s text (not its tags or attributes) in a `qm-blank` span. Browser only. */
export function markBlanks(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  for (const node of nodes) {
    const text = node.data;
    const runs = blankRuns(text);
    if (runs.length === 0) continue;
    const parts = document.createDocumentFragment();
    let at = 0;
    for (const [start, end] of runs) {
      if (start > at) parts.append(text.slice(at, start));
      const span = document.createElement("span");
      span.className = BLANK_CLASS;
      span.textContent = text.slice(start, end);
      parts.append(span);
      at = end;
    }
    if (at < text.length) parts.append(text.slice(at));
    node.replaceWith(parts);
  }
}
