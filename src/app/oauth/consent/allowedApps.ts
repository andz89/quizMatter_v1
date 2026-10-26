/**
 * Which apps can connect to QuizMatter: only Claude. An app picks its own name, so the name proves nothing; what
 * counts is where the login code goes (the redirect address), e.g. https://claude.ai/api/mcp/auth_callback.
 */
export const ALLOWED_REDIRECT_HOSTS = ["claude.ai", "claude.com"];

/** Shown instead of Allow, and sent back by answerConsent, when the app isn't Claude. */
export const NOT_CLAUDE_MESSAGE = "This app isn't Claude, so it can't connect to QuizMatter.";

/** True only for an https address whose site is exactly claude.ai or claude.com (not claude.ai.evil.com). */
export function isAllowedRedirect(url: string): boolean {
  try {
    const { protocol, host } = new URL(url);
    return protocol === "https:" && ALLOWED_REDIRECT_HOSTS.includes(host);
  } catch {
    return false;
  }
}
