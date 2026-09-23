/** True while the user is typing in an editable field — used to let Delete/Escape/Space shortcuts skip past text input. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}
