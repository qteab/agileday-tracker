/**
 * Access-token freshness, shared by any provider that calls AgileDay.
 *
 * This mirrors the logic embedded in `createAgileDayProvider`. It lives on its
 * own so the beta MCP provider doesn't have to reach into the REST provider —
 * the REST one can adopt it later without changing behaviour.
 */

import type { AuthConfig, AuthState } from "./auth";
import { isTokenExpired, refreshAuthState } from "./auth";

/** Refresh proactively when the token has less than this left. */
const PROACTIVE_REFRESH_MS = 120_000;

/** Wait between the two refresh attempts made on an already-expired token. */
const REFRESH_RETRY_DELAY_MS = 1000;

export interface TokenProviderDeps {
  authConfig: AuthConfig;
  getAuthState: () => AuthState | null;
  setAuthState: (state: AuthState) => void;
  clearAuthState: () => void;
}

export function createTokenProvider(deps: TokenProviderDeps): () => Promise<string> {
  return async function getValidToken(): Promise<string> {
    const auth = deps.getAuthState();
    if (!auth) throw new Error("Not authenticated — please log in");

    if (isTokenExpired(auth, 0)) {
      if (!auth.refreshToken) {
        deps.clearAuthState();
        throw new Error("Session expired — please log in again");
      }

      // Two attempts. `refreshAuthState` dedupes parallel callers so the
      // background timer, the visibility handler and an in-flight call can't
      // each burn a rotating refresh token.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const newState = await refreshAuthState(deps.authConfig, auth);
          deps.setAuthState(newState);
          return newState.accessToken;
        } catch {
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
          }
        }
      }
      deps.clearAuthState();
      throw new Error("Session expired — please log in again");
    }

    // Still valid, but close enough to expiry to warm a new one. Best effort —
    // never block the call that triggered it.
    if (isTokenExpired(auth, PROACTIVE_REFRESH_MS) && auth.refreshToken) {
      refreshAuthState(deps.authConfig, auth)
        .then(deps.setAuthState)
        .catch(() => {});
    }

    return auth.accessToken;
  };
}
