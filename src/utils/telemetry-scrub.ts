import type { CaptureResult } from "posthog-js";

/**
 * Telemetry is anonymous: no event may carry anything that identifies a person
 * or reveals what they worked on. Our own events only send counts and flags,
 * but exception messages are free text — AgileDay errors embed the request URL
 * (which contains the employee ID) and the server's response body (which can
 * echo an entry description). These helpers strip that before sending.
 */

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/**
 * Drops everything after the first ": ", then redacts URLs and emails.
 * Our messages put the variable detail last ("API error 500 at <url>: <body>",
 * "Token refresh failed (400): <body>"), so the part before it is the stable,
 * safe summary — and identical errors group together in PostHog.
 * The cut happens first because the URL pattern would otherwise swallow the
 * ":" that marks where the body starts.
 */
export function scrubErrorMessage(message: string): string {
  const detailStart = message.indexOf(": ");
  const summary = detailStart === -1 ? message : message.slice(0, detailStart);

  const withoutUrls = summary.replace(URL_PATTERN, "<url>");
  const withoutEmails = withoutUrls.replace(EMAIL_PATTERN, "<email>");
  return withoutEmails;
}

interface ExceptionListItem {
  value?: unknown;
}

/** PostHog before_send hook: scrubs every message in an $exception event. */
export function scrubExceptionEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event || event.event !== "$exception") return event;

  const exceptionList: unknown = event.properties.$exception_list;
  if (!Array.isArray(exceptionList)) return event;

  for (const exception of exceptionList as ExceptionListItem[]) {
    if (typeof exception.value === "string") {
      exception.value = scrubErrorMessage(exception.value);
    }
  }
  return event;
}
