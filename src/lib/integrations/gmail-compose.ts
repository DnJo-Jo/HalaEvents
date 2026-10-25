/**
 * Gmail compose link (no OAuth, no API): opens a pre-filled compose window that the organizer
 * reviews and sends themselves. Pure, so it can run in the browser.
 */
const COMPOSE = "https://mail.google.com/mail/?view=cm&fs=1";

/** Longest compose URL we hand to the browser; beyond this the organizer copies the text instead. */
export const GMAIL_URL_MAX = 6000;

export interface ComposeFields {
  /**
   * Google account to compose from (the organizer's connected address). `authuser` takes an email
   * address, so this doesn't depend on which account index the browser has them at. If that account
   * isn't signed in, Google asks which account to use instead of opening another one.
   */
  account?: string;
  to?: string;
  subject: string;
  body: string;
}

/** Compose URL with every field percent-encoded; null when it would be too long to open reliably. */
export function gmailComposeUrl(f: ComposeFields): string | null {
  const q = new URLSearchParams();
  const account = f.account?.trim();
  if (account) q.set("authuser", account);
  const to = f.to?.trim();
  if (to) q.set("to", to);
  q.set("su", f.subject);
  // Gmail expects CRLF-free text; URLSearchParams encodes newlines as %0A, which it accepts.
  q.set("body", f.body.replace(/\r\n/g, "\n"));
  const url = `${COMPOSE}&${q.toString()}`;
  return url.length <= GMAIL_URL_MAX ? url : null;
}
