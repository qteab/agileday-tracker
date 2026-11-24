/**
 * The HTTP layer under the AgileDay provider: keeping a usable access token,
 * resolving a fetch implementation, and turning a response into either data or
 * an error. Everything above this file deals in paths and JSON.
 */

import { posthogLogger } from "../posthog";
import type { AuthConfig, AuthState } from "./auth";
import { isTokenExpired, refreshAuthState } from "./auth";

/** Refresh ahead of expiry by this much, in the background. */
const PROACTIVE_REFRESH_MS = 120_000;

/** Wait between the two refresh attempts made when the token is already expired. */
const REFRESH_RETRY_DELAY_MS = 1000;

const SESSION_EXPIRED = "Session expired — please log in again";

export interface AgileDayConfig {
  /** e.g. "https://qvik.agileday.io/api" */
  apiBaseUrl: string;
  authConfig: AuthConfig;
}

export interface AuthStateAccess {
  getAuthState: () => AuthState | null;
  setAuthState: (state: AuthState) => void;
  clearAuthState: () => void;
}

/** Issues one authenticated request and returns its parsed body. */
export type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * A valid access token, refreshing if needed.
 *
 * Refresh is attempted twice when the token has already expired, because the
 * first attempt can lose a race against another caller rotating the refresh
 * token. `refreshAuthState` dedupes parallel callers, so the retry only covers
 * genuine failures rather than piling more requests onto one rotation.
 */
async function getValidToken(config: AgileDayConfig, auth: AuthStateAccess): Promise<string> {
  const state = auth.getAuthState();
  if (!state) throw new Error("Not authenticated — please log in");

  if (isTokenExpired(state, 0)) {
    if (!state.refreshToken) {
      auth.clearAuthState();
      throw new Error(SESSION_EXPIRED);
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const refreshed = await refreshAuthState(config.authConfig, state);
        auth.setAuthState(refreshed);
        return refreshed.accessToken;
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
        }
      }
    }

    auth.clearAuthState();
    throw new Error(SESSION_EXPIRED);
  }

  // Nearing expiry: refresh in the background rather than making this request
  // wait for a token it does not yet need.
  if (isTokenExpired(state, PROACTIVE_REFRESH_MS) && state.refreshToken) {
    refreshAuthState(config.authConfig, state)
      .then(auth.setAuthState)
      .catch(() => {});
  }

  return state.accessToken;
}

/**
 * The Tauri HTTP plugin, which can set the Origin header AgileDay requires.
 * Resolved once per provider and cached; falls back to the global fetch so the
 * provider still works outside the Tauri shell (tests, browser dev server).
 */
function createFetchResolver(fetchOverride?: typeof globalThis.fetch) {
  let resolved: typeof globalThis.fetch | null = fetchOverride ?? null;

  return async function resolveFetch(): Promise<typeof globalThis.fetch> {
    if (!resolved) {
      try {
        const mod = await import("@tauri-apps/plugin-http");
        resolved = mod.fetch;
      } catch {
        resolved = globalThis.fetch;
      }
    }
    return resolved;
  };
}

async function readBody<T>(response: Response, url: string): Promise<T> {
  if (response.status === 401) {
    const body = await response.text().catch(() => "");
    throw new Error(`Auth failed (401) at ${url}: ${body}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`API error ${response.status} at ${url}: ${errorText}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function createApiFetch(
  config: AgileDayConfig,
  auth: AuthStateAccess,
  fetchOverride?: typeof globalThis.fetch
): ApiFetch {
  const resolveFetch = createFetchResolver(fetchOverride);

  return async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getValidToken(config, auth);
    const url = `${config.apiBaseUrl}${path}`;
    if (!url.startsWith("https://")) {
      throw new Error("API calls must use HTTPS");
    }

    const doFetch = await resolveFetch();
    const method = options.method ?? "GET";
    const startedAt = performance.now();

    let response: Response;
    try {
      response = await doFetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Origin: new URL(config.apiBaseUrl).origin,
          ...(options.headers as Record<string, string> | undefined),
        },
      });
    } catch (err) {
      const elapsed = Math.round(performance.now() - startedAt);
      console.log(`[AgileDay] ${method} ${url} → network error (${elapsed}ms)`);
      posthogLogger?.warn("agileday_api_network_error", {
        http_method: method,
        duration_ms: elapsed,
      });
      throw err;
    }

    const elapsed = Math.round(performance.now() - startedAt);
    console.log(`[AgileDay] ${method} ${url} → ${response.status} (${elapsed}ms)`);

    if (!response.ok) {
      posthogLogger?.error("agileday_api_request_failed", {
        http_method: method,
        http_status_code: response.status,
        duration_ms: elapsed,
      });
    }

    return readBody<T>(response, url);
  };
}
