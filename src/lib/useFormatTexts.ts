import { useMemo } from "react";
import { useEditorStore, type TextEditorEntry } from "@/lib/store";

const NO_TEXTS: TextEditorEntry[] = [];

/**
 * The texts the format toolbar and color panel change: the one being typed in (its selected words),
 * or else every selected question/option box (all of its text). While elements are selected, only a
 * text box selected on its own counts (so one click on it shows the format toolbar).
 */
export function useFormatTexts(): TextEditorEntry[] {
  const editor = useEditorStore((s) => s.activeTextEditor);
  const target = useEditorStore((s) => s.activeTextTarget);
  const hasSelectedElements = useEditorStore((s) => s.selectedElementIds.length > 0);
  const boxes = useEditorStore((s) => s.selectedTextEditors);

  return useMemo(() => {
    if (editor && target) return [{ editor, target }];
    if (!hasSelectedElements) return boxes;
    const textBoxes = boxes.filter((box) => box.target.kind === "textBox");
    return textBoxes.length > 0 ? textBoxes : NO_TEXTS;
  }, [editor, target, hasSelectedElements, boxes]);
}
