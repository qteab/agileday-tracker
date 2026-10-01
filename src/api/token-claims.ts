/**
 * JWT claim inspection and typed auth failures.
 *
 * Kept separate from `auth.ts` so the beta MCP path can classify rejections
 * without disturbing the REST provider's existing error handling.
 */

/** The subset of AgileDay's JWT payload this app reads. */
export interface TokenClaims {
  sub?: string;
  employee_id?: string;
  uid?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  /** Resource the token was minted for, e.g. `https://qvik.agileday.io/api/v1/mcp`. */
  aud?: string | string[];
  /** Space-separated OAuth scopes, e.g. `mcp:read mcp:write`. */
  scope?: string;
  [claim: string]: unknown;
}

/** Decode a JWT payload without verifying it. Returns null on any malformed input. */
export function decodeTokenClaims(accessToken: string): TokenClaims | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as TokenClaims;
  } catch {
    return null;
  }
}

/**
 * Why the API rejected our token.
 *
 * - `expired` — past its lifetime; a refresh should recover it.
 * - `wrong-audience` — structurally fine, but minted for a different resource
 *   than the one being called. Refreshing re-mints the same wrong token, so
 *   only a configuration change fixes it.
 * - `forbidden` — authenticated, but the role may not reach this endpoint.
 * - `unauthorized` — rejected for a reason we can't classify.
 */
export type AuthErrorKind = "expired" | "wrong-audience" | "forbidden" | "unauthorized";

/** An API rejection that is about authentication, not about the request. */
export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly status: number;
  readonly url: string;
  /** The server's raw response body, kept for diagnostics. */
  readonly body: string;

  constructor(args: {
    kind: AuthErrorKind;
    status: number;
    url: string;
    body: string;
    message: string;
  }) {
    super(args.message);
    this.name = "AuthError";
    this.kind = args.kind;
    this.status = args.status;
    this.url = args.url;
    this.body = args.body;
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}

/**
 * Does this token's `aud` claim cover calls to `resourceUrl`?
 *
 * AgileDay mints audience-restricted tokens. Since REST-audience issuance was
 * withdrawn, an OAuth token carries `aud: <base>/api/v1/mcp`, which covers the
 * MCP endpoint and nothing else. A token with no `aud` is treated as covering
 * the resource — absence of the claim is not evidence of a mismatch.
 */
export function audienceCovers(claims: TokenClaims | null, resourceUrl: string): boolean {
  if (!claims?.aud) return true;
  const target = resourceUrl.replace(/\/+$/, "");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return audiences.some((aud) => {
    const value = String(aud).replace(/\/+$/, "");
    // Covered when the audience is the resource itself or a path ancestor of
    // it — never when it names a sibling or a narrower sub-resource.
    return target === value || target.startsWith(`${value}/`);
  });
}

/** Does this token cover the MCP endpoint under `apiBaseUrl`? */
export function audienceCoversMcp(claims: TokenClaims | null, apiBaseUrl: string): boolean {
  return audienceCovers(claims, `${apiBaseUrl.replace(/\/+$/, "")}/v1/mcp`);
}
