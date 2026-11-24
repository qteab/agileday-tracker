/**
 * Reading claims out of the access token. AgileDay's token carries the
 * employee id and enough profile data to render a signed-in user before the
 * profile endpoint answers, so several call sites need the payload without a
 * round-trip. Decoding only — the signature is the server's business.
 */

export interface JwtPayload {
  sub?: string;
  employee_id?: string;
  uid?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

/** The token's payload claims, or null if it is absent or unreadable. */
export function decodeJwtPayload(token: string | null | undefined): JwtPayload | null {
  const segment = token?.split(".")[1];
  if (!segment) return null;
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64)) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * The employee id, from whichever claim carries one. Blank claims are skipped
 * rather than accepted: a token with `sub: ""` must fall through to the next
 * claim, not resolve to an empty id that every later request then 404s on.
 */
export function employeeIdFromPayload(payload: JwtPayload | null): string | null {
  if (!payload) return null;
  return payload.sub || payload.employee_id || payload.uid || null;
}

/** Convenience for the common case: token straight to employee id. */
export function employeeIdFromToken(token: string | null | undefined): string | null {
  return employeeIdFromPayload(decodeJwtPayload(token));
}
