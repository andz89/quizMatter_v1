import { Extension, getHTMLFromFragment, getText, getTextSerializersFromSchema } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { Node, Schema } from "@tiptap/pm/model";

export const TEXT_LIMIT_MESSAGE = "This text is at its limit. Shorten it to add more.";

interface TextLimitOptions {
  // The most plain-text characters (as saved: paragraphs joined by "\n"); null = no limit.
  maxText: number | null;
  // The most HTML characters (as saved: the editor's getHTML()).
  maxHtml: number;
  // Called when a change was refused.
  onRefused: () => void;
}

/**
 * Refuses a change (typing, paste, a format button) that would push the text past the limits zod checks on save
 * (`PLAIN_TEXT_MAX`, `HTML_MAX` in schema.ts), so a save never fails for it. Only a change that makes an over-limit
 * text longer is refused: deleting always works, and outside changes (undo, Clear text: `setContent` without an
 * update) always go through.
 */
export const TextLimit = Extension.create<TextLimitOptions>({
  name: "textLimit",

  addOptions() {
    return { maxText: null, maxHtml: Infinity, onRefused: () => {} };
  },

  addProseMirrorPlugins() {
    const { maxText, maxHtml, onRefused } = this.options;
    const textLength = (doc: Node, schema: Schema) =>
      getText(doc, { blockSeparator: "\n", textSerializers: getTextSerializersFromSchema(schema) }).length;
    const htmlLength = (doc: Node, schema: Schema) => getHTMLFromFragment(doc.content, schema).length;
    // Over a limit and longer than before.
    const grewPast = (limit: number | null, measure: (doc: Node, schema: Schema) => number, doc: Node, before: Node) => {
      if (limit === null) return false;
      const after = measure(doc, doc.type.schema);
      return after > limit && after > measure(before, before.type.schema);
    };

    return [
      new Plugin({
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta("preventUpdate")) return true;
          const isRefused = grewPast(maxText, textLength, tr.doc, state.doc) || grewPast(maxHtml, htmlLength, tr.doc, state.doc);
          if (isRefused) onRefused();
          return !isRefused;
        },
      }),
    ];
  },
});
