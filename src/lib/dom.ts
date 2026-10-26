/** True while the user is typing in an editable field — used to let Delete/Escape/Space shortcuts skip past text input. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

/** True in a text field (input, textarea, rich text) or anywhere inside a dialog — places where Ctrl+V must paste text. */
export function isTextFieldOrDialog(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return isTypingTarget(target) || !!el?.closest?.('[role="dialog"]');
}
