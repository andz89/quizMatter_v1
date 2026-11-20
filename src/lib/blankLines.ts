import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import { BLANK_CLASS, blankRuns } from "./blanks";

function findBlanks(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const [start, end] of blankRuns(node.text))
      decorations.push(Decoration.inline(pos + start, pos + end, { class: BLANK_CLASS }));
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Joins fill-in blanks ("___") while typing on the canvas, like `markBlanks` does for read-only text (`blanks.ts`).
 * A decoration only changes how the text shows: `getHTML()` and the saved text never get the span.
 */
export const BlankLines = Extension.create({
  name: "blankLines",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        state: {
          init: (_, { doc }) => findBlanks(doc),
          apply: (tr, old) => (tr.docChanged ? findBlanks(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
