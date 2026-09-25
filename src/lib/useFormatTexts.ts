import { useMemo } from "react";
import { useEditorStore, type TextEditorEntry } from "@/lib/store";

const NO_TEXTS: TextEditorEntry[] = [];

/**
 * The texts the format toolbar and color panel change: the one being typed in (its selected words),
 * or else every selected question/option box (all of its text). None while shapes are selected.
 */
export function useFormatTexts(): TextEditorEntry[] {
  const editor = useEditorStore((s) => s.activeTextEditor);
  const target = useEditorStore((s) => s.activeTextTarget);
  const hasSelectedElements = useEditorStore((s) => s.selectedElementIds.length > 0);
  const boxes = useEditorStore((s) => s.selectedTextEditors);

  return useMemo(() => {
    if (editor && target) return [{ editor, target }];
    return hasSelectedElements ? NO_TEXTS : boxes;
  }, [editor, target, hasSelectedElements, boxes]);
}
