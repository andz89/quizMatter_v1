// crypto.randomUUID only exists on HTTPS or localhost, so fall back on plain HTTP (e.g. testing from a phone on the LAN).
export function createId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
