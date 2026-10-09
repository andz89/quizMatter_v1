// Throwaway email services the sign up page refuses (checked by signUpSchema in userSettings.ts). Only the most
// common ones: a full list (100,000+) would make the page heavy, and the Turnstile check already stops bots.
// Add a domain here if fake sign ups keep coming from it.
export const BLOCKED_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "discard.email",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemail.net",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "inboxkitten.com",
  "jetable.org",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "mytemp.email",
  "sharklasers.com",
  "spamgourmet.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

/** True if the email is at one of the throwaway services above (e.g. "x@mailinator.com"). */
export function isBlockedEmail(email: string) {
  return BLOCKED_EMAIL_DOMAINS.has(email.slice(email.lastIndexOf("@") + 1).toLowerCase());
}
